use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System, UpdateKind};

use crate::error::{app_err, AppResult};

pub const WINDOWS_CODEX_AUMIDS: &[&str] = &[
    "OpenAI.Codex_2p2nqsd0c76g0!App",
    "OpenAI.CodexBeta_2p2nqsd0c76g0!App",
    "OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0!App",
];

pub fn find_process_ids(manual_path: Option<&str>) -> Vec<u32> {
    let system = process_system();
    system
        .processes()
        .iter()
        .filter(|(_, process)| is_codex_desktop_process(process, manual_path))
        .map(|(pid, _)| pid.as_u32())
        .collect()
}

pub fn terminate_process_ids(ids: &[u32]) {
    let system = process_system();
    for id in ids {
        if let Some(process) = system.process(Pid::from_u32(*id)) {
            let _ = process.kill();
        }
    }
}

pub fn running_process_ids(ids: &[u32]) -> Vec<u32> {
    let system = process_system();
    ids.iter()
        .copied()
        .filter(|id| system.process(Pid::from_u32(*id)).is_some())
        .collect()
}

/// 优雅退出的等待上限：超过则强杀兜底（弹退出确认框、托盘拦截、headless bug 等
/// 场景下优雅请求会失效，强杀兜底保证重启必然成功）。
pub const GRACEFUL_EXIT_TIMEOUT_MS: u64 = 4_000;

/// 强杀后的退出等待上限。SIGKILL/Terminate 几乎即时，5 秒只是防御性上限。
pub const FORCE_EXIT_TIMEOUT_MS: u64 = 5_000;

/// 结束 Codex 进程的先礼后兵阶梯：请求优雅退出 → 等待 → 超时强杀兜底。
/// 返回 true 表示目标进程已全部退出。
pub fn shutdown_process_ids(ids: &[u32]) -> bool {
    shutdown_process_ids_with(
        ids,
        GRACEFUL_EXIT_TIMEOUT_MS,
        FORCE_EXIT_TIMEOUT_MS,
        request_graceful_quit,
        terminate_process_ids,
        running_process_ids,
        std::thread::sleep,
    )
}

/// 请求 Codex 优雅退出，返回是否成功发出请求（能否真正退出由调用方轮询判定）。
/// - Windows：向 Codex 进程的可见顶层窗口投 WM_CLOSE，Electron 主进程收到后走
///   window-all-closed → app.quit() 完整退出流程；helper 进程（gpu/network 等）
///   没有顶层窗口，天然只会命中主进程。
/// - macOS：osascript 发 AppleEvent quit（等同 Cmd+Q），对 Electron 的 Codex.app
///   与原生的 ChatGPT.app 通吃；AppleScript `with timeout` 自我限定 3 秒，
///   应用弹退出确认框时 osascript 自行超时退出，不会挂住。
pub fn request_graceful_quit(ids: &[u32]) -> bool {
    #[cfg(windows)]
    {
        post_close_messages(ids)
    }
    #[cfg(not(windows))]
    {
        let _ = ids;
        macos_request_quit()
    }
}

#[cfg(windows)]
fn post_close_messages(ids: &[u32]) -> bool {
    use std::collections::HashSet;

    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::core::BOOL;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE,
    };

    struct CloseTargets {
        pids: HashSet<u32>,
        posted: bool,
    }
    // EnumWindows 同步回调：在返回前于同一线程依次执行，通过 LPARAM 传上下文。
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        // SAFETY: lparam 指向本线程栈上的 CloseTargets，EnumWindows 返回前不会再被使用
        let targets = unsafe { &mut *(lparam.0 as *mut CloseTargets) };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid != 0 && targets.pids.contains(&pid) && unsafe { IsWindowVisible(hwnd) }.as_bool() {
            let _ = unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) };
            targets.posted = true;
        }
        true.into()
    }

    let mut targets = CloseTargets {
        pids: ids.iter().copied().collect(),
        posted: false,
    };
    let enumerated = unsafe {
        EnumWindows(
            Some(enum_proc),
            LPARAM(&mut targets as *mut CloseTargets as isize),
        )
    };
    if enumerated.is_err() {
        return false;
    }
    targets.posted
}

#[cfg(not(windows))]
fn macos_request_quit() -> bool {
    let Some(app) = macos_app_candidate() else {
        return false;
    };
    let Some(name) = app.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    let name = name.replace('\\', "\\\\").replace('"', "\\\"");
    // spawn 不等待：osascript 由 with timeout 自我限定生命周期，目标进程被强杀后
    // 会立即收到错误退出，不会残留
    Command::new("osascript")
        .args([
            "-e",
            "with timeout of 3 seconds",
            "-e",
            &format!("quit app \"{name}\""),
            "-e",
            "end timeout",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

pub fn shutdown_process_ids_with<F, G, W, S>(
    ids: &[u32],
    graceful_timeout_ms: u64,
    force_timeout_ms: u64,
    request_quit: F,
    terminate: G,
    mut running: W,
    mut sleep: S,
) -> bool
where
    F: Fn(&[u32]) -> bool,
    G: Fn(&[u32]),
    W: FnMut(&[u32]) -> Vec<u32>,
    S: FnMut(Duration),
{
    if ids.is_empty() {
        return true;
    }
    if request_quit(ids)
        && wait_for_exit_with(ids, graceful_timeout_ms, 100, &mut running, &mut sleep)
    {
        return true;
    }
    terminate(ids);
    wait_for_exit_with(ids, force_timeout_ms, 100, &mut running, &mut sleep)
}

fn process_system() -> System {
    System::new_with_specifics(
        // 只需要进程可执行文件路径判断 Codex 桌面进程；不刷新 CPU/内存/磁盘等无关数据，
        // 避免每 3 秒轮询和每次 get_state 全量扫描系统进程产生无谓开销
        RefreshKind::nothing()
            .with_processes(ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet)),
    )
}

pub fn wait_for_exit_with<F, S>(
    ids: &[u32],
    timeout_ms: u64,
    interval_ms: u64,
    mut running: F,
    mut sleep: S,
) -> bool
where
    F: FnMut(&[u32]) -> Vec<u32>,
    S: FnMut(Duration),
{
    if ids.is_empty() {
        return true;
    }
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if running(ids).is_empty() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(Duration::from_millis(interval_ms));
    }
}

pub fn wait_for_running_with<F, S>(
    timeout_ms: u64,
    interval_ms: u64,
    mut running: F,
    mut sleep: S,
) -> bool
where
    F: FnMut() -> bool,
    S: FnMut(Duration),
{
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if running() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        sleep(Duration::from_millis(interval_ms));
    }
}

pub fn wait_for_running(timeout_ms: u64, interval_ms: u64) -> bool {
    wait_for_running_with(
        timeout_ms,
        interval_ms,
        || !find_process_ids(None).is_empty(),
        std::thread::sleep,
    )
}

pub fn launch_codex(manual_path: Option<&str>) -> AppResult<()> {
    #[cfg(windows)]
    {
        if let Some(executable) = windows_standalone_executable(manual_path).filter(|path| {
            !path
                .to_string_lossy()
                .to_ascii_lowercase()
                .contains("\\windowsapps\\")
        }) {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            Command::new(&executable)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|error| app_err!("无法启动 Codex: {error}"))?;
            return Ok(());
        }

        if activate_windows_package(manual_path).is_ok() {
            return Ok(());
        }
        Err(app_err!("未找到可启动的 Codex/ChatGPT 桌面应用"))
    }

    #[cfg(not(windows))]
    {
        let app = manual_path
            .map(PathBuf::from)
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("app"))
            .or_else(macos_app_candidate)
            .ok_or_else(|| app_err!("未找到可启动的 Codex/ChatGPT 桌面应用"))?;
        // 先走常规 open -a；SIGKILL 结束主进程后 LaunchServices 的“运行中”状态
        // 存在短暂窗口未同步，open -a 会向已死实例转发激活事件而失败
        // （_LSOpenURLsWithCompletionHandler error -600 procNotFound），导致
        // “重启后拉不起来”。此时改用 open -n 强制启动新实例绕开陈旧状态；
        // 若真有实例存活的竞态，应用自身的单实例机制会让新进程转发事件后
        // 退出并激活旧实例，同样无害。
        if macos_open_app(&app, false).is_ok() {
            return Ok(());
        }
        macos_open_app(&app, true)
    }
}

/// 用 LaunchServices 打开 macOS 应用，返回 `open` 的真实执行结果（旧实现
/// 只 spawn 不查退出码，-600 等失败会被静默吞掉，只能靠上层轮询超时暴露）。
#[cfg(not(windows))]
fn macos_open_app(app: &Path, force_new_instance: bool) -> AppResult<()> {
    let output = Command::new("open")
        .args(macos_open_args(app, force_new_instance))
        .stdin(Stdio::null())
        .output()
        .map_err(|error| app_err!("无法启动 Codex: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let detail = if detail.is_empty() {
        format!("exit {}", output.status)
    } else {
        detail
    };
    Err(app_err!("无法启动 Codex: {detail}"))
}

#[cfg(not(windows))]
fn macos_open_args(app: &Path, force_new_instance: bool) -> Vec<String> {
    let mut args = Vec::new();
    if force_new_instance {
        args.push("-n".into());
    }
    args.push("-a".into());
    args.push(app.display().to_string());
    args
}

#[cfg(windows)]
fn activate_windows_package(manual_path: Option<&str>) -> AppResult<()> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        ApplicationActivationManager, IApplicationActivationManager, ACTIVATEOPTIONS,
    };

    if manual_path.is_some_and(|value| value.to_ascii_lowercase().ends_with(".exe")) {
        return Err(app_err!("manual executable"));
    }

    unsafe {
        let coinitialize = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninitialize = coinitialize.is_ok();
        if !should_uninitialize && coinitialize.0 != -2147417850 {
            return Err(app_err!("Windows COM 初始化失败"));
        }

        let result: AppResult<()> = (|| {
            let manager: IApplicationActivationManager =
                CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_ALL)
                    .map_err(|error| app_err!("无法创建应用激活器: {error}"))?;
            let mut last_error = None;
            for aumid in WINDOWS_CODEX_AUMIDS {
                match manager.ActivateApplication(
                    &HSTRING::from(*aumid),
                    &HSTRING::from(""),
                    ACTIVATEOPTIONS(0),
                ) {
                    Ok(_) => return Ok(()),
                    Err(error) => last_error = Some(error),
                }
            }
            Err(app_err!(
                "无法启动 Codex/ChatGPT packaged app: {}",
                last_error
                    .map(|error| error.to_string())
                    .unwrap_or_default()
            ))
        })();

        if should_uninitialize {
            CoUninitialize();
        }
        result
    }
}

#[cfg(windows)]
fn windows_standalone_executable(manual_path: Option<&str>) -> Option<PathBuf> {
    let candidates: Vec<PathBuf> = manual_path
        .map(PathBuf::from)
        .into_iter()
        .chain(
            std::env::var_os("LOCALAPPDATA")
                .map(|root| PathBuf::from(root).join("OpenAI").join("Codex")),
        )
        .collect();
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
        for name in ["Codex.exe", "ChatGPT.exe"] {
            let executable = candidate.join(name);
            if executable.is_file() {
                return Some(executable);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn macos_app_candidate() -> Option<PathBuf> {
    let home = crate::paths::home_dir();
    let names = [
        "Codex.app",
        "OpenAI Codex.app",
        "OpenAI.Codex.app",
        "ChatGPT.app",
    ];
    let roots = [PathBuf::from("/Applications"), home.join("Applications")];
    roots
        .iter()
        .flat_map(|root| names.iter().map(move |name| root.join(name)))
        .find(|path| path.is_dir())
}

pub fn codex_display_path(manual_path: Option<&str>) -> (String, String) {
    if let Some(manual) = manual_path.filter(|value| !value.trim().is_empty()) {
        return (manual.to_string(), "manual".into());
    }

    #[cfg(windows)]
    {
        (WINDOWS_CODEX_AUMIDS[0].to_string(), "packaged-app".into())
    }

    #[cfg(not(windows))]
    {
        let path = macos_app_candidate()
            .map(|value| value.display().to_string())
            .unwrap_or_else(|| "未识别".into());
        (path, "auto".into())
    }
}

fn is_codex_desktop_process(process: &sysinfo::Process, manual_path: Option<&str>) -> bool {
    #[cfg(windows)]
    {
        let Some(exe) = process.exe() else {
            return false;
        };
        is_windows_codex_process(exe, manual_path)
    }

    #[cfg(not(windows))]
    {
        let _ = manual_path;
        process.exe().is_some_and(is_macos_codex_executable)
    }
}

#[cfg(windows)]
pub fn is_windows_codex_process(exe: &Path, manual_path: Option<&str>) -> bool {
    let exe_text = exe
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    let file_name = exe
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let is_codex_name = file_name.eq_ignore_ascii_case("Codex.exe")
        || file_name.eq_ignore_ascii_case("ChatGPT.exe");
    if !is_codex_name {
        return false;
    }

    if exe_text.contains("\\windowsapps\\") {
        return !exe_text.contains("\\app\\resources\\")
            && (exe_text.contains("\\openai.codex_")
                || exe_text.contains("\\openai.codexbeta_")
                || exe_text.contains("\\openai.chatgpt-desktop_"));
    }

    if let Some(manual) = manual_path {
        let root = Path::new(manual);
        let root = if root.is_file() {
            root.parent().unwrap_or(root)
        } else {
            root
        };
        let root_text = root
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase();
        return !root_text.is_empty() && exe_text.starts_with(&root_text);
    }

    exe_text.contains("\\openai\\codex\\") || exe_text.contains("\\programs\\openai\\")
}

#[cfg(not(windows))]
pub fn is_macos_codex_executable(executable: &Path) -> bool {
    let is_main_executable = matches!(
        executable.file_name().and_then(|name| name.to_str()),
        Some("ChatGPT" | "Codex")
    );
    is_main_executable
        && executable
            .to_string_lossy()
            .contains(".app/Contents/MacOS/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_process_filter_excludes_cli_and_helpers() {
        let package = Path::new(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_1.0_x64__2p2nqsd0c76g0\App\Codex.exe",
        );
        let helper = Path::new(
            r"C:\Program Files\WindowsApps\OpenAI.Codex_1.0_x64__2p2nqsd0c76g0\App\resources\ChatGPT.exe",
        );
        let cli = Path::new(r"C:\Users\me\.codex\bin\codex.exe");
        assert!(is_windows_codex_process(package, None));
        assert!(!is_windows_codex_process(helper, None));
        assert!(!is_windows_codex_process(cli, None));
    }

    #[cfg(not(windows))]
    #[test]
    fn macos_process_filter_recognizes_main_app_executables_only() {
        assert!(is_macos_codex_executable(std::path::Path::new(
            "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"
        )));
        assert!(is_macos_codex_executable(std::path::Path::new(
            "/Applications/Codex.app/Contents/MacOS/Codex"
        )));
        assert!(!is_macos_codex_executable(std::path::Path::new(
            "/Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Versions/1/Helpers/Codex (Service).app/Contents/MacOS/Codex (Service)"
        )));
        assert!(!is_macos_codex_executable(std::path::Path::new(
            "/usr/local/bin/codex"
        )));
    }

    #[cfg(not(windows))]
    #[test]
    fn macos_open_args_order_matches_open_cli() {
        assert_eq!(
            macos_open_args(Path::new("/Applications/ChatGPT.app"), false),
            ["-a", "/Applications/ChatGPT.app"]
        );
        assert_eq!(
            macos_open_args(Path::new("/Applications/ChatGPT.app"), true),
            ["-n", "-a", "/Applications/ChatGPT.app"]
        );
    }

    #[test]
    fn wait_state_machine_handles_not_running_and_timeout() {
        assert!(wait_for_exit_with(
            &[1],
            0,
            0,
            |_: &[u32]| Vec::<u32>::new(),
            |_| {}
        ));
        assert!(!wait_for_exit_with(
            &[1],
            0,
            0,
            |ids: &[u32]| ids.to_vec(),
            |_| {}
        ));
    }

    #[test]
    fn wait_for_running_succeeds_after_launch() {
        let mut checks = 0;
        assert!(wait_for_running_with(
            1_000,
            0,
            || {
                checks += 1;
                checks >= 2
            },
            |_| {},
        ));
    }

    #[test]
    fn wait_for_running_times_out_when_launch_does_not_create_a_process() {
        assert!(!wait_for_running_with(0, 0, || false, |_| {}));
    }

    #[test]
    fn shutdown_ladder_returns_true_without_processes() {
        let quit = std::cell::Cell::new(0);
        let kill = std::cell::Cell::new(0);
        assert!(shutdown_process_ids_with(
            &[],
            1_000,
            1_000,
            |_| {
                quit.set(quit.get() + 1);
                true
            },
            |_| kill.set(kill.get() + 1),
            |_| Vec::new(),
            |_| {},
        ));
        assert_eq!(quit.get(), 0);
        assert_eq!(kill.get(), 0);
    }

    #[test]
    fn shutdown_ladder_exits_gracefully_without_force_kill() {
        let quit = std::cell::Cell::new(0);
        let kill = std::cell::Cell::new(0);
        let mut checks = 0u32;
        assert!(shutdown_process_ids_with(
            &[7],
            1_000,
            1_000,
            |_| {
                quit.set(quit.get() + 1);
                true
            },
            |_| kill.set(kill.get() + 1),
            |_| {
                checks += 1;
                if checks >= 2 {
                    Vec::new()
                } else {
                    vec![7]
                }
            },
            |_| {},
        ));
        assert_eq!(quit.get(), 1);
        assert_eq!(kill.get(), 0);
    }

    #[test]
    fn shutdown_ladder_escalates_to_force_kill_on_graceful_timeout() {
        let kill = std::cell::Cell::new(0);
        assert!(shutdown_process_ids_with(
            &[7],
            0,
            1_000,
            |_| true,
            |_| kill.set(kill.get() + 1),
            |ids| if kill.get() == 0 {
                ids.to_vec()
            } else {
                Vec::new()
            },
            |_| {},
        ));
        assert_eq!(kill.get(), 1);
    }

    #[test]
    fn shutdown_ladder_fails_when_force_kill_also_times_out() {
        assert!(!shutdown_process_ids_with(
            &[7],
            0,
            0,
            |_| true,
            |_| {},
            |ids| ids.to_vec(),
            |_| {},
        ));
    }

    #[test]
    fn shutdown_ladder_skips_graceful_wait_when_request_unavailable() {
        // Windows headless（MainWindowHandle=0）等场景：无窗口可投递，直接强杀兜底
        let quit = std::cell::Cell::new(0);
        let kill = std::cell::Cell::new(0);
        assert!(shutdown_process_ids_with(
            &[7],
            1_000,
            1_000,
            |_| {
                quit.set(quit.get() + 1);
                false
            },
            |_| kill.set(kill.get() + 1),
            |ids| if kill.get() == 0 {
                ids.to_vec()
            } else {
                Vec::new()
            },
            |_| {},
        ));
        assert_eq!(quit.get(), 1);
        assert_eq!(kill.get(), 1);
    }
}

# 测量约定

## 可比性

- Rust 微基准固定使用 `src-tauri/benches/config_bench.rs`，其临时目录不会触碰真实 `~/.cgswitch` 或 `~/.codex`。
- 每次保存新的 Criterion 标签，读取本次 `new/estimates.json`；旧标签只用于 Criterion 图表内部比较。
- 记录 Git 提交、工作区是否干净、Node/pnpm/Cargo/Rust 版本。硬件、供电模式或防病毒负载不同则标为环境变化。

## 体验测量

- `release-native` 冷启动：先确认没有同实例运行（App 注册了 single-instance，已有实例时再启动会走「聚焦已有窗口」路径，测到的不是冷启动，也不能由 AI 自行结束用户的实例）；计时终点必须是主窗口可见且进程可响应；记录至少三次。仅进程存在或端口监听不算启动完成。
- `release-native` 托盘恢复：关闭主窗口（`minimize_to_tray` 打开时应隐藏而非退出）→ 再次启动 exe 走 single-instance 聚焦 → 计到主窗口重新可见。这是托盘常驻应用最高频的用户动作，且比冷启动快得多（不重建 WebView2），两者必须分开记。
- 常驻资源：托盘挂机场景采样私有内存、句柄数与空闲 CPU。判读看**单调增长趋势**，不看单点绝对值；单次几十秒的采样不足以判断泄漏，至少十分钟起步。
- `dev-web`：可用于页面加载和交互趋势，但不能代替 Release 桌面数据。直接双击 `target/debug/cgswitch.exe` 不可测：dev 构建从 `localhost:5173` 取前端，Vite dev server 未运行时窗口永不显示。
- `web-mock`：可验证前端状态流和相对变化，不代表 IPC、文件系统扫描或外部 Codex CLI 的耗时。

### 判定「窗口可见」的正确方式

用 Win32 `EnumWindows` 遍历该 PID 的顶层窗口，取 `IsWindowVisible` 为真且标题等于 `CGswitch` 的那个。

**不要用 .NET 的 `Process.MainWindowHandle`**：它返回进程第一个可见顶层窗口，在本项目里会命中 single-instance 插件的窗口（标题 `com.zeno528.cgswitch-siw`），得到 45–87 ms 的假终点（真值约 650–760 ms）。`MainWindowTitle` 同时为空是它的典型症状。

### 可测的 Release 产物

只用 `bundle/` 里 MSI 对应的安装产物（如 `%LOCALAPPDATA%\CGswitch\cgswitch.exe`）。

**不要拿 `src-tauri/target/release/cgswitch.exe` 测**：`cargo bench` / `cargo build --release` 会顺带编译包内 bin target，但不走 tauri 打包流程，前端资源未嵌入，实测主窗口永不显示 —— 这会被误读成「窗口显示回归」。构建该文件的 `cargo bench` 还只影响时间戳，不产生 `bundle/`，可据此判别产物来源。

## 判读

- Criterion 的 95% 区间跨过零或仅出现极小差异时，写「噪声范围内」。
- `settings_write` 方差较大时，按 Criterion 提示增加测量时间后再判定回归。
- Vite 的 `>500 kB` 只提示拆包机会；需要结合真实首屏或交互数据后才能优化。

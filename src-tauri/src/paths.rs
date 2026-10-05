use std::path::{Path, PathBuf};

use crate::error::{app_err, AppResult};

/// 数据目录名。改名发布时旧目录由 [`migrate_legacy_root`] 一次性改名过来。
const ROOT_DIR: &str = ".budtty";
/// 改名前的数据目录名，仅迁移时读取，迁移成功后不再存在。
const LEGACY_ROOT_DIR: &str = ".cgswitch";

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub database: PathBuf,
    pub settings: PathBuf,
    /// 应用内更新「已更新到 vX」一次性标记：安装成功前写入，新版本启动时消费。
    /// 存文件而不是前端 localStorage——Windows 安装器会立即结束进程，WebView 的
    /// localStorage 异步落盘可能来不及提交导致标记丢失、通知不弹。
    pub update_marker: PathBuf,
    pub config_backup: PathBuf,
    pub database_backup: PathBuf,
    pub codex_files_backup: PathBuf,
    /// 运行日志目录：tauri-plugin-log 按大小轮转写入，保留最近几个归档
    pub logs: PathBuf,
    pub codex_home: PathBuf,
    /// Claude Code 的家目录（~/.claude）：供应商配置写入其下 settings.json。
    pub claude_home: PathBuf,
    /// 供应商终端的 per-session settings 覆盖文件目录：只放 `claude --settings`
    /// 的临时覆盖，不进 ~/.claude，不参与 apply 与回写。
    pub terminal: PathBuf,
    /// 本次启动是否刚把旧版数据目录改名过来。定位数据目录时日志插件还没挂上，
    /// 留这个标记给调用方在 logger 就绪后补记，否则这次改名不留任何痕迹。
    pub migrated_from_legacy: bool,
}

impl AppPaths {
    pub fn codex_config(&self) -> PathBuf {
        self.codex_home.join("config.toml")
    }

    /// Claude Code 用户范围 MCP 配置（官方格式：用户目录下的 ~/.claude.json）。
    pub fn claude_mcp_config(&self) -> PathBuf {
        self.claude_home
            .parent()
            .unwrap_or(&self.claude_home)
            .join(".claude.json")
    }

    /// 某个 Claude 供应商的终端覆盖文件：固定命名、每次覆写，不随进程删除。
    pub fn terminal_settings(&self, profile_id: &str) -> PathBuf {
        self.terminal.join(format!("claude_{profile_id}.json"))
    }

    pub fn ensure(&self) -> AppResult<()> {
        for dir in [
            &self.root,
            &self.config_backup,
            &self.database_backup,
            &self.codex_files_backup,
            &self.logs,
            &self.terminal,
        ] {
            std::fs::create_dir_all(dir)
                .map_err(|error| app_err!("无法创建目录 {}: {error}", dir.display()))?;
        }
        Ok(())
    }
}

pub fn app_paths() -> AppResult<AppPaths> {
    let home = home_dir();
    let migrated_from_legacy = migrate_legacy_root(&home);
    let mut paths = from_home(&home)?;
    paths.migrated_from_legacy = migrated_from_legacy;
    Ok(paths)
}

/// 旧版数据目录（`.cgswitch`）改名到 `.budtty`，只在首次启动时发生一次。
///
/// 用改名而不是复制：旧目录在本机实测 57 MB / 2700+ 文件（托管 skills 仓库 42 MB、
/// 日志轮转 10 MB、配置备份 3 MB），逐文件复制会直接击穿冷启动秒开的底线。两个目录
/// 同处 home 之下必然同卷，改名是 O(1) 元数据操作，无中间态、不吃启动预算。
///
/// 三道守卫：新目录已存在（旧版本迁过、或用户自己建过）一律不动，绝不覆盖已有数据；
/// 旧目录不存在就是全新安装，直接跳过；改名失败（旧版本进程仍持有句柄）也不阻断启动——
/// 拿不到旧数据只是要重新配置一遍，启不来才是真故障。
fn migrate_legacy_root(home: &Path) -> bool {
    let legacy = home.join(LEGACY_ROOT_DIR);
    let current = home.join(ROOT_DIR);
    if !legacy.is_dir() || current.exists() {
        return false;
    }
    std::fs::rename(&legacy, &current).is_ok()
}

pub fn from_home(home: &Path) -> AppResult<AppPaths> {
    let root = home.join(ROOT_DIR);
    Ok(AppPaths {
        database: root.join("budtty.db"),
        settings: root.join("settings.json"),
        update_marker: root.join("update-marker"),
        config_backup: root.join("backups").join("config"),
        database_backup: root.join("backups").join("database"),
        codex_files_backup: root.join("backups").join("codex-files"),
        logs: root.join("logs"),
        terminal: root.join("terminal"),
        codex_home: home.join(".codex"),
        claude_home: home.join(".claude"),
        root,
        migrated_from_legacy: false,
    })
}

pub fn home_dir() -> PathBuf {
    directories::BaseDirs::new()
        .map(|base| base.home_dir().to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

pub fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default()
}

/// Unix 秒（i64 语义由调用方按需转换）：备份文件名与 token 时间戳共用同一个"当前时刻"定义。
pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_use_budtty_and_codex_directories() {
        let home = Path::new("/home/user");
        let paths = from_home(home).unwrap();
        assert_eq!(paths.root, home.join(".budtty"));
        assert_eq!(paths.database, home.join(".budtty").join("budtty.db"));
        assert_eq!(paths.logs, home.join(".budtty").join("logs"));
        assert_eq!(
            paths.codex_config(),
            home.join(".codex").join("config.toml")
        );
        assert_eq!(paths.claude_home, home.join(".claude"));
        assert_eq!(paths.claude_mcp_config(), home.join(".claude.json"));
        assert_eq!(paths.terminal, home.join(".budtty").join("terminal"));
        assert_eq!(
            paths.terminal_settings("p-1"),
            home.join(".budtty")
                .join("terminal")
                .join("claude_p-1.json")
        );
    }

    /// 造一个旧版数据目录：数据库 + WAL + 嵌套的托管 skills 仓库。
    fn legacy_home(home: &Path) -> PathBuf {
        let legacy = home.join(LEGACY_ROOT_DIR);
        std::fs::create_dir_all(legacy.join("skills").join("alpha")).unwrap();
        std::fs::write(legacy.join("cgswitch.db"), b"old-db").unwrap();
        std::fs::write(legacy.join("cgswitch.db-wal"), b"old-wal").unwrap();
        std::fs::write(legacy.join("settings.json"), b"{}").unwrap();
        std::fs::write(
            legacy.join("skills").join("alpha").join("SKILL.md"),
            b"skill",
        )
        .unwrap();
        legacy
    }

    #[test]
    fn legacy_data_directory_is_renamed_so_nothing_is_left_behind() {
        let home = tempfile::tempdir().unwrap();
        let legacy = legacy_home(home.path());

        assert!(migrate_legacy_root(home.path()), "旧目录应被改名");
        assert!(!legacy.exists(), "改名不是复制，旧目录不该留在原地");

        let current = home.path().join(ROOT_DIR);
        // 改名的意义就是不丢数据：库、WAL、嵌套 skills 目录都得原样搬过去
        assert_eq!(
            std::fs::read(current.join("cgswitch.db")).unwrap(),
            b"old-db"
        );
        assert_eq!(
            std::fs::read(current.join("cgswitch.db-wal")).unwrap(),
            b"old-wal"
        );
        assert_eq!(
            std::fs::read_to_string(current.join("skills").join("alpha").join("SKILL.md")).unwrap(),
            "skill"
        );
    }

    #[test]
    fn an_existing_new_directory_blocks_migration() {
        let home = tempfile::tempdir().unwrap();
        // 新目录存在但为空：这是唯一能让 rename 真正成功的形态，
        // 所以删掉 `current.exists()` 守卫时这个用例会红，而不是靠 rename 碰巧失败蒙混过去
        std::fs::create_dir_all(home.path().join(ROOT_DIR)).unwrap();
        let legacy = legacy_home(home.path());

        assert!(!migrate_legacy_root(home.path()), "新目录已存在时不该迁移");
        assert!(legacy.exists(), "没迁移，旧目录必须原样保留");
    }

    #[test]
    fn existing_new_directory_data_survives() {
        let home = tempfile::tempdir().unwrap();
        let current = home.path().join(ROOT_DIR);
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(current.join("budtty.db"), b"already-migrated").unwrap();
        legacy_home(home.path());

        migrate_legacy_root(home.path());

        // 用户可能已经用新版写过数据：新目录的内容一个字都不能少
        assert_eq!(
            std::fs::read(current.join("budtty.db")).unwrap(),
            b"already-migrated"
        );
    }

    #[test]
    fn a_fresh_install_migrates_nothing() {
        let home = tempfile::tempdir().unwrap();
        assert!(!migrate_legacy_root(home.path()), "没有旧目录就不该有迁移");
        assert!(!home.path().join(ROOT_DIR).exists(), "迁移不该凭空造目录");
    }
}

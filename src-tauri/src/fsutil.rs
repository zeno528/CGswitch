use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;

use crate::error::{app_err, AppResult};
use crate::paths::now_ms;

pub fn atomic_write(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| app_err!("无法创建目录 {}: {error}", parent.display()))?;
    }

    let mut temp = NamedTempFile::new_in(path.parent().unwrap_or(Path::new(".")))
        .map_err(|error| app_err!("无法创建临时文件: {error}"))?;
    temp.write_all(bytes)
        .and_then(|_| temp.flush())
        .map_err(|error| app_err!("无法写入临时文件: {error}"))?;
    let temp_path = temp.into_temp_path();
    replace_file(&temp_path, path)
        .map_err(|error| app_err!("无法替换 {}: {error}", path.display()))?;
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> io::Result<()> {
    fs::rename(source, target)
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_utf16: Vec<_> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target_utf16: Vec<_> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let result = MoveFileExW(
            PCWSTR::from_raw(source_utf16.as_ptr()),
            PCWSTR::from_raw(target_utf16.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        );
        result.map_err(|error| io::Error::other(error.to_string()))
    }
}

pub fn backup_file(source: &Path, directory: &Path, stem: &str) -> AppResult<Option<PathBuf>> {
    if !source.exists() {
        return Ok(None);
    }
    fs::create_dir_all(directory)
        .map_err(|error| app_err!("无法创建备份目录 {}: {error}", directory.display()))?;
    let target = directory.join(format!("{stem}-{}.bak", now_ms()));
    fs::copy(source, &target)
        .map_err(|error| app_err!("无法备份 {}: {error}", source.display()))?;
    prune_backups(directory, stem, ".bak", 5);
    Ok(Some(target))
}

pub fn prune_backups(directory: &Path, prefix: &str, extension: &str, keep: usize) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut backups: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(prefix) && name.ends_with(extension))
        })
        .collect();
    backups.sort();
    while backups.len() > keep {
        let oldest = backups.remove(0);
        let _ = fs::remove_file(oldest);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, b"old = true\n").unwrap();

        atomic_write(&path, b"new = true\n").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new = true\n");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

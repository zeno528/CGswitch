//! Skill 管理：扫描、导入、启停、删除与 SKILL.md 描述解析。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde_json::Value;

use super::catalog::validate_plugin_name;
use super::{SkillCandidate, SkillSummary, SKILL_BACKUP_DIRECTORY, SKILL_SOURCE_FILE};
use crate::error::{app_err, AppResult};
use crate::paths::now_ms;
use crate::services::AppContext;

// ponytail: 只读 SKILL.md frontmatter 的单行 description；多行 YAML 描述暂不展开。
/// 从 SKILL.md frontmatter 提取 description：支持单行值与 YAML 块标量（`|`/`>`，
/// 含 `|-`、`>+` 等 chomping 变体）。折叠按 YAML 语义简化：相邻行并作空格、
/// 空行保留为换行；`|` 字面量逐行保留换行。
pub(super) fn read_skill_description(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let lines: Vec<&str> = text.lines().take(40).collect();
    let mut frontmatter = false;
    let mut index = 0;
    while index < lines.len() {
        let trimmed = lines[index].trim();
        index += 1;
        if index == 1 && trimmed == "---" {
            frontmatter = true;
            continue;
        }
        if frontmatter && trimmed == "---" {
            break;
        }
        if !frontmatter {
            continue;
        }
        let Some(value) = trimmed.strip_prefix("description:") else {
            continue;
        };
        let value = value.trim().trim_matches(['"', '\'']);
        if value.is_empty() {
            continue;
        }
        if !value.starts_with(['|', '>']) {
            return Some(value.to_string());
        }
        let literal = value.starts_with('|');
        let mut folded = String::new();
        let mut pending_break = false;
        while index < lines.len() {
            let line = lines[index];
            let trimmed_line = line.trim();
            // 块标量终止：遇到顶格非空行（下一个键或 frontmatter 结束）
            if !trimmed_line.is_empty() && !line.starts_with([' ', '\t']) {
                break;
            }
            index += 1;
            if trimmed_line.is_empty() {
                pending_break = !folded.is_empty();
            } else {
                if !folded.is_empty() {
                    folded.push_str(if literal || pending_break { "\n" } else { " " });
                }
                folded.push_str(trimmed_line);
                pending_break = false;
            }
        }
        return (!folded.is_empty()).then_some(folded);
    }
    None
}

/// 列出插件目录内全部文件的目录内相对路径（插件体量小，直接递归）。
pub(super) fn walk_files(root: &Path) -> Vec<String> {
    fn visit(base: &Path, dir: &Path, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(base, &path, out);
            } else if let Ok(relative) = path.strip_prefix(base) {
                out.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    let mut files = Vec::new();
    visit(root, root, &mut files);
    files
}

/// 读取 `~/.agents/.skill-lock.json`（Codex 的 Skill 安装注册表，实测布局）。
pub(super) fn read_managed_skills(repository: &Path, home: &Path) -> Vec<SkillSummary> {
    let sources = read_skill_sources(repository);
    let mut skills = Vec::new();
    if let Ok(entries) = fs::read_dir(repository) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.join("SKILL.md").is_file() {
                let source_path = sources.get(&name).cloned();
                let enabled = home.join(".codex/skills").join(&name).is_dir();
                skills.push(SkillSummary {
                    name,
                    description: read_skill_description(&path.join("SKILL.md")),
                    source_url: None,
                    store_path: path.display().to_string(),
                    update_available: source_path
                        .as_ref()
                        .map(|source| {
                            Path::new(source).is_dir()
                                && !directories_equal(Path::new(source), &path)
                        })
                        .unwrap_or(false),
                    source_path,
                    enabled,
                });
            }
        }
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    skills
}

pub(super) fn skill_repository(root: &Path) -> PathBuf {
    root.join("skills")
}

pub(super) fn same_skill_path(left: &Path, right: &Path) -> bool {
    fs::canonicalize(left).ok() == fs::canonicalize(right).ok()
}

pub(super) fn is_registered_skill(home: &Path, name: &str) -> bool {
    fs::read_to_string(home.join(".agents/.skill-lock.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|lock| lock.get("skills").and_then(Value::as_object).cloned())
        .is_some_and(|skills| skills.contains_key(name))
}

pub(super) fn skill_io<T>(result: std::io::Result<T>) -> AppResult<T> {
    result.map_err(|error| app_err!("Skill 文件操作失败: {error}"))
}

pub(super) fn read_skill_sources(repository: &Path) -> BTreeMap<String, String> {
    fs::read_to_string(repository.join(SKILL_SOURCE_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub(super) fn write_skill_sources(
    repository: &Path,
    sources: &BTreeMap<String, String>,
) -> AppResult<()> {
    let path = repository.join(SKILL_SOURCE_FILE);
    let text = serde_json::to_string_pretty(sources)
        .map_err(|error| app_err!("Skill 来源记录序列化失败: {error}"))?;
    skill_io(fs::create_dir_all(
        path.parent().expect("Skill 来源文件有父目录"),
    ))?;
    skill_io(fs::write(path, text))?;
    Ok(())
}

pub(super) fn copy_skill(source: &Path, target: &Path) -> AppResult<()> {
    if !source.join("SKILL.md").is_file() {
        return Err(app_err!("所选目录不是 Skill：缺少 SKILL.md"));
    }
    copy_skill_directory(source, target)
}

pub(super) fn copy_skill_directory(source: &Path, target: &Path) -> AppResult<()> {
    skill_io(fs::create_dir_all(target))?;
    for entry in skill_io(fs::read_dir(source))? {
        let entry = skill_io(entry)?;
        let destination = target.join(entry.file_name());
        if entry.path().is_dir() {
            copy_skill_directory(&entry.path(), &destination)?;
        } else {
            skill_io(fs::copy(entry.path(), destination))?;
        }
    }
    Ok(())
}

pub(super) fn directories_equal(left: &Path, right: &Path) -> bool {
    if !left.is_dir() || !right.is_dir() {
        return false;
    }
    let mut left_files = walk_files(left);
    let mut right_files = walk_files(right);
    left_files.sort();
    right_files.sort();
    if left_files.len() != right_files.len() {
        return false;
    }
    left_files
        .into_iter()
        .all(|relative| fs::read(left.join(&relative)).ok() == fs::read(right.join(&relative)).ok())
}

pub(super) fn skill_modified_at(path: &Path) -> u64 {
    fs::metadata(path.join("SKILL.md"))
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

pub(super) fn backup_skill(repository: &Path, name: &str) -> AppResult<Option<PathBuf>> {
    let source = repository.join(name);
    if !source.is_dir() {
        return Ok(None);
    }
    let destination = repository
        .join(SKILL_BACKUP_DIRECTORY)
        .join(name)
        .join(now_ms().to_string());
    copy_skill_directory(&source, &destination)?;
    Ok(Some(destination))
}

pub(super) fn distribute_skill(home: &Path, repository: &Path, name: &str) -> AppResult<()> {
    replace_skill(
        &repository.join(name),
        &home.join(".codex/skills").join(name),
    )
}

pub(super) fn replace_skill(source: &Path, target: &Path) -> AppResult<()> {
    let staged = target.with_extension(format!("cgswitch-{}", now_ms()));
    if staged.exists() {
        skill_io(fs::remove_dir_all(&staged))?;
    }
    copy_skill(source, &staged)?;
    if !directories_equal(source, &staged) {
        let _ = fs::remove_dir_all(&staged);
        return Err(app_err!("Skill 文件校验失败"));
    }
    if target.exists() {
        skill_io(fs::remove_dir_all(target))?;
    }
    skill_io(fs::rename(staged, target))?;
    Ok(())
}

impl AppContext {
    /// Codex Skill 注册表中的独立 Skill 列表。
    pub async fn list_skills(&self) -> AppResult<Vec<SkillSummary>> {
        let repository = skill_repository(&self.paths.root);
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Ok(Vec::new());
        };
        tauri::async_runtime::spawn_blocking(move || read_managed_skills(&repository, &home))
            .await
            .map_err(|error| app_err!("Skill 列表任务失败: {error}"))
    }

    pub async fn get_skill_content(&self, name: &str) -> AppResult<String> {
        validate_plugin_name(name)?;
        let path = skill_repository(&self.paths.root)
            .join(name)
            .join("SKILL.md");
        tauri::async_runtime::spawn_blocking(move || skill_io(fs::read_to_string(path)))
            .await
            .map_err(|error| app_err!("Skill 内容读取任务失败: {error}"))?
    }

    pub async fn get_import_skill_content(&self, source_path: &str) -> AppResult<String> {
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let source = PathBuf::from(source_path);
        tauri::async_runtime::spawn_blocking(move || {
            let source = skill_io(fs::canonicalize(source))?;
            let allowed = [home.join(".agents/skills"), home.join(".codex/skills")]
                .into_iter()
                .filter_map(|root| fs::canonicalize(root).ok())
                .any(|root| source.parent() == Some(root.as_path()));
            if !allowed {
                return Err(app_err!("只能预览已扫描到的本地 Skill"));
            }
            skill_io(fs::read_to_string(source.join("SKILL.md")))
        })
        .await
        .map_err(|error| app_err!("Skill 内容读取任务失败: {error}"))?
    }

    pub async fn scan_unmanaged_skills(&self) -> AppResult<Vec<SkillCandidate>> {
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Ok(Vec::new());
        };
        let repository = skill_repository(&self.paths.root);
        let sources = read_skill_sources(&repository);
        tauri::async_runtime::spawn_blocking(move || {
            let mut candidates = Vec::new();
            for (root, source) in [
                (home.join(".codex/skills"), "Codex"),
                (home.join(".agents/skills"), "Agent"),
            ] {
                let Ok(entries) = fs::read_dir(root) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !path.join("SKILL.md").is_file() {
                        continue;
                    }
                    let managed = repository.join(&name);
                    if managed.is_dir() {
                        // 已管理 Skill 只认导入时记录的外部本源，避免把另一边的旧分发副本误报成更新。
                        if let Some(source_path) = sources.get(&name).map(PathBuf::from) {
                            if !same_skill_path(&source_path, &path) {
                                continue;
                            }
                        }
                        if directories_equal(&managed, &path) {
                            continue;
                        }
                    }
                    if candidates.iter().any(|candidate: &SkillCandidate| {
                        candidate.name == name
                            && directories_equal(Path::new(&candidate.store_path), &path)
                    }) {
                        continue;
                    }
                    candidates.push(SkillCandidate {
                        name,
                        description: read_skill_description(&path.join("SKILL.md")),
                        store_path: path.display().to_string(),
                        source: source.to_string(),
                        has_content_conflict: false,
                        is_update: managed.is_dir(),
                        modified_at: skill_modified_at(&path),
                    });
                }
            }
            for index in 0..candidates.len() {
                let name = candidates[index].name.clone();
                let path = PathBuf::from(&candidates[index].store_path);
                candidates[index].has_content_conflict =
                    candidates.iter().enumerate().any(|(other_index, other)| {
                        other_index != index
                            && other.name == name
                            && !directories_equal(&path, Path::new(&other.store_path))
                    });
            }
            candidates.sort_by(|left, right| {
                left.name
                    .cmp(&right.name)
                    .then_with(|| left.source.cmp(&right.source))
            });
            Ok(candidates)
        })
        .await
        .map_err(|error| app_err!("Skill 扫描任务失败: {error}"))?
    }

    pub async fn import_skill(&self, source_path: &str) -> AppResult<()> {
        let repository = skill_repository(&self.paths.root);
        let source = PathBuf::from(source_path);
        tauri::async_runtime::spawn_blocking(move || {
            let name = source
                .file_name()
                .and_then(|item| item.to_str())
                .ok_or_else(|| app_err!("无法识别 Skill 名称"))?;
            validate_plugin_name(name)?;
            let target = repository.join(name);
            if source == target {
                return Err(app_err!("该 Skill 已在管理目录中"));
            }
            backup_skill(&repository, name)?;
            replace_skill(&source, &target)?;
            let mut sources = read_skill_sources(&repository);
            sources.insert(name.to_string(), source.display().to_string());
            write_skill_sources(&repository, &sources)?;
            Ok(())
        })
        .await
        .map_err(|error| app_err!("Skill 导入任务失败: {error}"))?
    }

    pub async fn enable_skill(&self, name: &str) -> AppResult<()> {
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let repository = skill_repository(&self.paths.root);
        let name = name.to_string();
        tauri::async_runtime::spawn_blocking(move || distribute_skill(&home, &repository, &name))
            .await
            .map_err(|error| app_err!("Skill 启用任务失败: {error}"))?
    }

    pub async fn disable_skill(&self, name: &str) -> AppResult<()> {
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let name = name.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let distributed = home.join(".codex/skills").join(&name);
            if distributed.is_dir() {
                skill_io(fs::remove_dir_all(distributed))?;
            }
            Ok(())
        })
        .await
        .map_err(|error| app_err!("Skill 停用任务失败: {error}"))?
    }

    pub async fn delete_skill(&self, name: &str) -> AppResult<()> {
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let repository = skill_repository(&self.paths.root);
        let name = name.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let stored = repository.join(&name);
            if !stored.is_dir() {
                return Err(app_err!("Skill 不存在"));
            }
            skill_io(fs::remove_dir_all(&stored))?;
            let distributed = home.join(".codex/skills").join(&name);
            if distributed.is_dir() {
                skill_io(fs::remove_dir_all(distributed))?;
            }
            let mut sources = read_skill_sources(&repository);
            sources.remove(&name);
            write_skill_sources(&repository, &sources)
        })
        .await
        .map_err(|error| app_err!("Skill 删除任务失败: {error}"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::plugins::test_context;

    #[test]
    fn read_skill_description_folds_block_scalar() {
        // 实测样本（nezha-manager 等）：`>` 折叠块曾整段被跳过导致卡片无描述
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("SKILL.md");
        std::fs::write(
            &path,
            "---\nname: demo\ndescription: >\n  First folded line\n  continues here.\n\n  Second paragraph.\nlicense: MIT\n---\n# body\n",
        )
        .unwrap();

        assert_eq!(
            read_skill_description(&path).as_deref(),
            Some("First folded line continues here.\nSecond paragraph.")
        );
    }

    #[test]
    fn read_skill_description_keeps_literal_block_lines() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("SKILL.md");
        std::fs::write(
            &path,
            "---\ndescription: |-\n  Step one\n  Step two\n---\n# body\n",
        )
        .unwrap();

        assert_eq!(
            read_skill_description(&path).as_deref(),
            Some("Step one\nStep two")
        );
    }

    #[tokio::test]
    async fn scan_unmanaged_skills_deduplicates_identical_skills() {
        let (home, context) = test_context();
        for root in [".agents/skills", ".codex/skills"] {
            let skill = home.path().join(root).join("same-skill");
            std::fs::create_dir_all(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), "---\ndescription: 相同内容\n---\n").unwrap();
        }

        let candidates = context.scan_unmanaged_skills().await.unwrap();
        assert_eq!(
            candidates
                .iter()
                .filter(|candidate| candidate.name == "same-skill")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn scan_unmanaged_skills_marks_same_name_with_different_content() {
        let (home, context) = test_context();
        for (root, content) in [
            (".agents/skills", "---\ndescription: 版本 A\n---\n"),
            (".codex/skills", "---\ndescription: 版本 B\n---\n"),
        ] {
            let skill = home.path().join(root).join("different-skill");
            std::fs::create_dir_all(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), content).unwrap();
        }

        let candidates = context.scan_unmanaged_skills().await.unwrap();
        let matches: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.name == "different-skill")
            .collect();
        assert_eq!(matches.len(), 2);
        assert!(matches
            .iter()
            .all(|candidate| candidate.has_content_conflict));
    }

    #[tokio::test]
    async fn scan_unmanaged_skills_reports_auxiliary_changes() {
        let (home, context) = test_context();
        for root in [".agents/skills", ".codex/skills"] {
            let skill = home.path().join(root).join("matching-skill");
            std::fs::create_dir_all(skill.join("logs")).unwrap();
            std::fs::write(skill.join("SKILL.md"), "---\ndescription: 相同内容\n---\n").unwrap();
            std::fs::write(skill.join("logs/source.md"), root).unwrap();
        }

        let candidates = context.scan_unmanaged_skills().await.unwrap();
        let matches: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.name == "matching-skill")
            .collect();
        assert_eq!(matches.len(), 2);
        assert!(matches
            .iter()
            .all(|candidate| candidate.has_content_conflict));
        assert!(matches.iter().all(|candidate| !candidate.is_update));
    }

    #[tokio::test]
    async fn scan_unmanaged_skills_reports_managed_updates() {
        let (home, context) = test_context();
        let repository_root = skill_repository(&context.paths.root);
        let repository = repository_root.join("managed-skill");
        std::fs::create_dir_all(&repository).unwrap();
        std::fs::write(
            repository.join("SKILL.md"),
            "---\ndescription: 旧版本\n---\n",
        )
        .unwrap();

        let agent_skill = home.path().join(".agents/skills/managed-skill");
        let codex_skill = home.path().join(".codex/skills/managed-skill");
        for (skill, description) in [
            (&agent_skill, "Agent 旧副本"),
            (&codex_skill, "Codex 新版本"),
        ] {
            std::fs::create_dir_all(skill).unwrap();
            std::fs::write(
                skill.join("SKILL.md"),
                format!("---\ndescription: {description}\n---\n"),
            )
            .unwrap();
        }
        write_skill_sources(
            &repository_root,
            &BTreeMap::from([(
                "managed-skill".to_string(),
                codex_skill.display().to_string(),
            )]),
        )
        .unwrap();

        let candidates = context.scan_unmanaged_skills().await.unwrap();
        let matches: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.name == "managed-skill")
            .collect();
        assert_eq!(matches.len(), 1);
        assert!(matches[0].is_update);
        assert!(!matches[0].has_content_conflict);
        assert_eq!(matches[0].source, "Codex");
    }

    #[tokio::test]
    async fn local_skill_import_and_update_keep_plugin_skills_separate() {
        let (home, context) = test_context();
        let source = home.path().join("Downloads/local-skill");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("SKILL.md"), "---\ndescription: 初始版本\n---\n").unwrap();

        context
            .import_skill(&source.display().to_string())
            .await
            .unwrap();
        let initial = context.list_skills().await.unwrap();
        assert_eq!(
            initial
                .iter()
                .find(|skill| skill.name == "local-skill")
                .unwrap()
                .description
                .as_deref(),
            Some("初始版本")
        );
        let codex_skill = home.path().join(".codex/skills/local-skill");
        std::fs::create_dir_all(&codex_skill).unwrap();
        std::fs::write(
            codex_skill.join("SKILL.md"),
            "---\ndescription: Codex 中已修改\n---\n",
        )
        .unwrap();
        assert!(
            context
                .list_skills()
                .await
                .unwrap()
                .iter()
                .find(|skill| skill.name == "local-skill")
                .unwrap()
                .enabled
        );

        std::fs::write(source.join("SKILL.md"), "---\ndescription: 更新版本\n---\n").unwrap();
        assert!(
            context
                .list_skills()
                .await
                .unwrap()
                .iter()
                .find(|skill| skill.name == "local-skill")
                .unwrap()
                .update_available
        );
        context
            .import_skill(&source.display().to_string())
            .await
            .unwrap();
        assert_eq!(
            context
                .list_skills()
                .await
                .unwrap()
                .iter()
                .find(|skill| skill.name == "local-skill")
                .unwrap()
                .description
                .as_deref(),
            Some("更新版本")
        );
    }
}

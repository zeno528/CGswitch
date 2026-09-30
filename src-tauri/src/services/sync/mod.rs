//! live→数据库回写的统一时机层。
//! 「何时回写」只有这一份定义，引擎无关；每个客户端注册一个执行体（怎么解析、往哪写、什么算脏）。
//! B 类引擎自有钩子（Codex 的 live auth.json OAuth 回写）是异步路径、管理器由调用方持有，
//! 不走时机枚举，由调用方直连 `sync_live_oauth_auth`；新客户端若有凭证类文件，
//! 必须实现等价的新鲜度判定（归属 + 新旧，对齐 `sync_external_auth_json`）。

use std::sync::OnceLock;

use super::AppContext;
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClientId {
    Codex,
    Claude,
}

/// 回写时机。被动时机（StateRefresh）遍历全部注册执行体；其余时机只作用于 `client` 指定的执行体。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncTrigger {
    /// 任何主动刷新聚合状态：启动预发、窗口激活、UI 刷新、托盘切换、页内 refresh。
    /// ponytail: get_state 单入口区分不了这些来源，收敛为一种被动时机。
    StateRefresh,
    /// 覆盖 live 之前（应用/切换供应商）。target_id = 即将写入的目标配置。
    BeforeLiveOverwrite { client: ClientId, target_id: String },
    /// 读取配置详情之前（打开编辑页）。目标就是激活配置时才需要同步。
    BeforeProfileRead { client: ClientId, target_id: String },
    /// 复制配置之前（副本必须取最新快照）。目标就是激活配置时才需要同步。
    BeforeProfileClone { client: ClientId, target_id: String },
    /// 捕获当前 live 为新配置之后。
    AfterCapture { client: ClientId },
    /// 拉起该客户端进程之前（目前仅 Codex 的 restart_codex 构造）。
    BeforeProcessStart { client: ClientId },
}

impl SyncTrigger {
    fn is_passive(&self) -> bool {
        matches!(self, SyncTrigger::StateRefresh)
    }

    fn client(&self) -> ClientId {
        match self {
            SyncTrigger::BeforeLiveOverwrite { client, .. }
            | SyncTrigger::BeforeProfileRead { client, .. }
            | SyncTrigger::BeforeProfileClone { client, .. }
            | SyncTrigger::AfterCapture { client }
            | SyncTrigger::BeforeProcessStart { client } => *client,
            _ => ClientId::Codex,
        }
    }
}

/// 调用方已解析的 live 材料：已持有解析结果时直接复用，避免启动路径二次读盘。
/// 各执行体按需取用自己客户端的字段。
#[derive(Default, Clone, Copy)]
pub struct SyncMaterial<'a> {
    pub codex_document: Option<&'a toml_edit::DocumentMut>,
}

/// 每客户端执行体。新客户端只需实现这一个 trait。
pub trait ClientSync: Send + Sync {
    fn id(&self) -> ClientId;

    /// 显式声明响应哪些时机。不响应必须写出来，不允许沉默。
    fn supports(&self, trigger: &SyncTrigger) -> bool;

    /// 执行回写，返回是否真的写了库。实现方必须自行完成四道基础守卫
    /// （无激活 / live 读不了 / 解析失败绝不覆盖最后有效快照 / 无差异不写）。
    fn sync(
        &self,
        ctx: &AppContext,
        trigger: &SyncTrigger,
        material: SyncMaterial<'_>,
    ) -> AppResult<bool>;
}

/// 宽松读路径：调用方已解析的文档优先，否则自行读取 live。
fn sync_loose(ctx: &AppContext, document: Option<&toml_edit::DocumentMut>) -> AppResult<bool> {
    match document {
        Some(document) => ctx.sync_active_profile_document(document),
        None => match ctx.live_document() {
            Some(document) => ctx.sync_active_profile_document(&document),
            None => Ok(false),
        },
    }
}

/// Codex 执行体：行为对齐原 6 个 A 类触发点（守卫语义只搬家不改写）。
struct CodexSyncBody;

impl ClientSync for CodexSyncBody {
    fn id(&self) -> ClientId {
        ClientId::Codex
    }

    fn supports(&self, _trigger: &SyncTrigger) -> bool {
        true
    }

    fn sync(
        &self,
        ctx: &AppContext,
        trigger: &SyncTrigger,
        material: SyncMaterial<'_>,
    ) -> AppResult<bool> {
        match trigger {
            // 覆盖 live 前（原 autosync_active_profile）：无激活 / 自切不做无意义写；
            // 错误向上传播——切换失败优先于覆盖 live。
            SyncTrigger::BeforeLiveOverwrite { target_id, .. } => {
                let Some(active_id) = ctx.active_profile_state()? else {
                    return Ok(false);
                };
                if active_id == *target_id {
                    return Ok(false);
                }
                sync_loose(ctx, material.codex_document)
            }
            // 打开编辑页/复制：目标就是激活配置时才同步（错误被调用方忽略）
            SyncTrigger::BeforeProfileRead { target_id, .. }
            | SyncTrigger::BeforeProfileClone { target_id, .. } => {
                if ctx.active_profile_state()?.as_deref() != Some(target_id.as_str()) {
                    return Ok(false);
                }
                sync_loose(ctx, material.codex_document)
            }
            // 拉起进程前：严格读 live，读不了/解析失败只记日志不拦——Codex 自己会报错；
            // 刻意不带 error 正文：解析报错会内嵌出错那一行的原文，可能是密钥。
            SyncTrigger::BeforeProcessStart { .. } => match ctx.live_document_checked() {
                Ok(Some(document)) => ctx.sync_active_profile_document(&document),
                Ok(None) => Ok(false),
                Err(_) => {
                    tauri_plugin_log::log::warn!(
                            "[app.config.parse] outcome=failure failure_kind=parse_error msg=\"config.toml 无法读取或解析，Codex 可能无法启动\""
                        );
                    Ok(false)
                }
            },
            // 被动刷新与捕获后：无激活直接跳过且不读 live 文件（冷启动预算）
            SyncTrigger::StateRefresh | SyncTrigger::AfterCapture { .. } => {
                if ctx.active_profile_state()?.is_none() {
                    return Ok(false);
                }
                sync_loose(ctx, material.codex_document)
            }
        }
    }
}

/// Claude 执行体：守卫沿用 sync_active_claude_settings 的四道守卫
/// （无激活/读不了/解析失败/无差异一律不写库，外部损坏绝不覆盖最后有效快照）。
/// 产品事实：Claude Code 读 settings.json 即时生效、无需重启进程，
/// 因此不存在对 Claude 构造 BeforeProcessStart 的场景。
struct ClaudeSyncBody;

impl ClientSync for ClaudeSyncBody {
    fn id(&self) -> ClientId {
        ClientId::Claude
    }

    fn supports(&self, _trigger: &SyncTrigger) -> bool {
        true
    }

    fn sync(
        &self,
        ctx: &AppContext,
        trigger: &SyncTrigger,
        _material: SyncMaterial<'_>,
    ) -> AppResult<bool> {
        match trigger {
            // 覆盖 live 前：无激活 / 自切跳过，其余先把旧激活快照同步到现场（缺口 C1）
            SyncTrigger::BeforeLiveOverwrite { target_id, .. } => {
                let Some(active) = ctx.database.active_claude_profile()? else {
                    return Ok(false);
                };
                if active == *target_id {
                    return Ok(false);
                }
                ctx.sync_active_claude_settings()
            }
            // 打开编辑页/复制前：目标就是激活配置时才同步（缺口 C3）
            SyncTrigger::BeforeProfileRead { target_id, .. }
            | SyncTrigger::BeforeProfileClone { target_id, .. } => {
                if ctx.database.active_claude_profile()?.as_deref() != Some(target_id.as_str()) {
                    return Ok(false);
                }
                ctx.sync_active_claude_settings()
            }
            // 被动刷新与捕获后：无激活直接跳过且不读 live 文件（冷启动预算）
            SyncTrigger::StateRefresh | SyncTrigger::AfterCapture { .. } => {
                if ctx.database.active_claude_profile()?.is_none() {
                    return Ok(false);
                }
                ctx.sync_active_claude_settings()
            }
            // Claude 无需重启进程，无人构造此时机；保守按 no-op 处理
            SyncTrigger::BeforeProcessStart { .. } => Ok(false),
        }
    }
}

pub struct SyncRegistry {
    bodies: Vec<Box<dyn ClientSync>>,
}

impl SyncRegistry {
    /// 收割：首个执行体出错即中断剩余执行体并返回（被动路径自愈，下一轮补上；
    /// 调用方用 `?` 或 `let _` 决定传播，对齐原各触发点两种错误语义并存的现状）。
    /// 顺序 = 注册顺序（确定）。互斥由调用方保证：两个引擎的 apply（覆盖 live 的
    /// 临界段，含 BeforeLiveOverwrite 收割）都在 operation 锁内调用；被动路径走
    /// harvest_passive 让路；读/捕获路径（Read/Clone/AfterCapture）不持锁，
    /// 接受与切换的窄竞态（重构前即如此，SQLite 连接锁兜底单条写）。
    pub fn harvest(
        &self,
        ctx: &AppContext,
        trigger: &SyncTrigger,
        material: SyncMaterial<'_>,
    ) -> AppResult<()> {
        // 冷启动预算：被动回写落在 get_state 同步路径上，超阈值必须可见
        let started = std::time::Instant::now();
        for body in self
            .bodies
            .iter()
            .filter(|body| trigger.is_passive() || body.id() == trigger.client())
            .filter(|body| body.supports(trigger))
        {
            let synced = body.sync(ctx, trigger, material)?;
            tauri_plugin_log::log::debug!(
                "[sync.harvest] client={:?} trigger={:?} synced={} msg=\"回写结果\"",
                body.id(),
                trigger,
                synced
            );
        }
        let elapsed_ms = started.elapsed().as_millis();
        if elapsed_ms > 50 {
            tauri_plugin_log::log::warn!(
                "[sync.harvest] trigger={:?} latency_ms={} outcome=success msg=\"回写耗时超过 50ms 预算\"",
                trigger,
                elapsed_ms
            );
        }
        Ok(())
    }

    /// 被动收割（get_state 路径）：操作锁被切换/应用/重启占用就跳过本轮，
    /// 下一轮激活自愈；不阻塞 UI 刷新，不放大首屏延迟。失败不冒泡成 get_state 失败。
    pub fn harvest_passive(
        &self,
        ctx: &AppContext,
        trigger: &SyncTrigger,
        material: SyncMaterial<'_>,
    ) {
        match ctx.operation.try_lock() {
            Ok(_guard) => {
                if let Err(error) = self.harvest(ctx, trigger, material) {
                    // 内部错误也统一截断，与仓库日志规范一致（防 sqlite 报错内嵌意外长文本）
                    let brief: String = error.0.chars().take(160).collect();
                    tauri_plugin_log::log::warn!(
                        "[sync.harvest] outcome=failure failure_kind=internal error={:?} msg=\"被动回写失败，本轮跳过\"",
                        brief
                    );
                }
            }
            Err(_) => {
                tauri_plugin_log::log::debug!(
                    "[sync.harvest] trigger={:?} outcome=success msg=\"操作锁被占用，本轮跳过\"",
                    trigger
                );
            }
        }
    }
}

static REGISTRY: OnceLock<SyncRegistry> = OnceLock::new();

pub fn registry() -> &'static SyncRegistry {
    REGISTRY.get_or_init(|| SyncRegistry {
        bodies: vec![Box::new(CodexSyncBody), Box::new(ClaudeSyncBody)],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_context() -> (tempfile::TempDir, AppContext) {
        let home = tempfile::tempdir().unwrap();
        let paths = crate::paths::from_home(home.path()).unwrap();
        paths.ensure().unwrap();
        std::fs::create_dir_all(&paths.codex_home).unwrap();
        std::fs::write(paths.codex_config(), "model = \"glm-5.3\"\n").unwrap();
        let context = AppContext::new(paths.clone()).unwrap();
        (home, context)
    }

    #[test]
    fn passive_harvest_converges_external_drift_into_active_snapshot() {
        let (_home, context) = test_context();
        let profile = context.capture_profile("A").unwrap();
        context.apply_profile(&profile.id).unwrap();
        // 外部改写 live：被动收割后激活快照必须收敛到最新内容
        std::fs::write(context.paths.codex_config(), "model = \"glm-5.4\"\n").unwrap();
        registry().harvest_passive(
            &context,
            &SyncTrigger::StateRefresh,
            SyncMaterial::default(),
        );
        let stored = context.database.profile(&profile.id).unwrap();
        assert!(stored
            .payload
            .raw_config
            .as_deref()
            .unwrap_or_default()
            .contains("glm-5.4"));
        // 幂等：同内容再收割一次仍是 no-op，不报错
        registry().harvest_passive(
            &context,
            &SyncTrigger::StateRefresh,
            SyncMaterial::default(),
        );
    }

    #[test]
    fn harvest_without_active_profile_is_a_noop() {
        let (_home, context) = test_context();
        // 无激活：被动与客户端域时机都是 no-op，不读 live、不写库、不报错
        registry()
            .harvest(
                &context,
                &SyncTrigger::StateRefresh,
                SyncMaterial::default(),
            )
            .unwrap();
        registry()
            .harvest(
                &context,
                &SyncTrigger::BeforeLiveOverwrite {
                    client: ClientId::Codex,
                    target_id: "any".into(),
                },
                SyncMaterial::default(),
            )
            .unwrap();
        assert!(context.database.profiles().unwrap().is_empty());
    }
}

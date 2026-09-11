use super::{
    app_err, atomic_write, backup_file, now_ms, parse_external_auth_json, read_optional_text,
    AppContext, AppResult, AuthSource, ManagedAccount, ProfileKind,
};
use crate::auth::codex_oauth::{CodexOAuthManager, ExternalCodexAuth};

impl AppContext {
    /// 在切换或刷新前吸收 Codex 运行中产生的同账号 OAuth auth.json。
    pub async fn sync_live_oauth_auth(&self, oauth: &CodexOAuthManager) -> AppResult<()> {
        let Some(text) = read_optional_text(&self.paths.codex_home.join("auth.json")) else {
            return Ok(());
        };
        oauth
            .sync_external_auth_json(&text)
            .await
            .map_err(|error| app_err!("{error}"))?;
        Ok(())
    }

    /// 把认证原文写入 ~/.codex/auth.json（写前备份旧文件）。
    pub(super) fn write_auth_json(&self, content: &str) -> AppResult<()> {
        let destination = self.paths.codex_home.join("auth.json");
        backup_file(&destination, &self.paths.codex_files_backup, "auth")?;
        atomic_write(&destination, content.as_bytes())?;
        Ok(())
    }

    fn read_external_codex_auth(&self) -> Option<ExternalCodexAuth> {
        read_optional_text(&self.paths.codex_home.join("auth.json"))
            .as_deref()
            .and_then(parse_external_auth_json)
    }

    /// 识别 Codex 官方外部认证（~/.codex/auth.json，由 codex login 生成）。
    /// 只读识别、不导入数据库；不是有效的 ChatGPT 订阅认证时返回 None。
    pub fn external_codex_auth(&self) -> AppResult<Option<ManagedAccount>> {
        let Some(auth) = self.read_external_codex_auth() else {
            return Ok(None);
        };
        Ok(Some(ManagedAccount {
            id: auth.account_id,
            login: auth
                .email
                .unwrap_or_else(|| "ChatGPT（Codex 官方认证）".to_string()),
            authenticated_at: 0,
            is_default: false,
        }))
    }

    /// 读取 live auth.json 中有效的 ChatGPT 订阅 access_token（外部 Codex 认证）。
    pub fn external_codex_access_token(&self) -> AppResult<Option<String>> {
        Ok(self
            .read_external_codex_auth()
            .map(|auth| auth.access_token))
    }

    /// 读取 live auth.json 中属于指定账号的 ChatGPT access_token。
    pub fn external_codex_access_token_for_account(
        &self,
        account_id: &str,
    ) -> AppResult<Option<String>> {
        Ok(self
            .read_external_codex_auth()
            .filter(|auth| auth.account_id == account_id)
            .map(|auth| auth.access_token))
    }

    /// 是否为官方订阅供应商（无 API 供应商，凭据走 ChatGPT 订阅）。
    pub fn is_subscription_profile(&self, id: &str) -> AppResult<bool> {
        Ok(self.database.profile(id)?.kind == ProfileKind::Official)
    }

    /// 官方供应商绑定的订阅账号；Desktop 配置不绑定，OAuth 配置必须绑定。
    pub fn bound_account_id(&self, id: &str) -> AppResult<Option<String>> {
        Ok(self.database.profile(id)?.account_id.clone())
    }

    pub fn profile_auth_source(&self, id: &str) -> AppResult<Option<AuthSource>> {
        let profile = self.database.profile(id)?;
        Ok(profile
            .payload
            .effective_auth_source(profile.kind, profile.account_id.as_deref()))
    }

    pub(super) fn active_profile_state(&self) -> AppResult<Option<String>> {
        Ok(self.database.app_state()?.0)
    }

    /// 该供应商是否为当前使用中（以显式激活状态为准，不做配置比对）。
    pub fn is_active_profile(&self, id: &str) -> AppResult<bool> {
        Ok(self.active_profile_state()?.as_deref() == Some(id))
    }

    /// 仅 OAuth 配置允许切换绑定账号；Desktop 配置的认证来源在创建时固定。
    pub fn set_profile_account(&self, id: &str, account_id: Option<&str>) -> AppResult<()> {
        let stored = self.database.profile(id)?;
        if stored.kind != ProfileKind::Official {
            return Err(app_err!("第三方供应商不支持绑定订阅账号"));
        }
        if stored
            .payload
            .effective_auth_source(stored.kind, stored.account_id.as_deref())
            != Some(AuthSource::Oauth)
        {
            return Err(app_err!(
                "Desktop 配置不能切换为 OAuth，请新建 ChatGPT 配置"
            ));
        }
        let Some(account_id) = account_id else {
            return Err(app_err!("OAuth 配置必须绑定一个订阅账号"));
        };
        if !self
            .database
            .accounts()?
            .iter()
            .any(|account| account.id == account_id)
        {
            return Err(app_err!("订阅账号不存在"));
        }
        self.database
            .set_profile_account(id, Some(account_id), &now_ms().to_string())
    }

    /// 切换 OAuth 配置所绑定的账号时，数据库绑定和 live auth 写入必须按激活顺序完成。
    pub async fn set_profile_account_and_apply_active(
        &self,
        id: &str,
        account_id: Option<&str>,
        oauth: &CodexOAuthManager,
    ) -> AppResult<()> {
        let _activation = self.activation.lock().await;
        self.sync_live_oauth_auth(oauth).await?;
        let active = self.profile_auth_source(id)? == Some(AuthSource::Oauth)
            && self.is_active_profile(id)?;
        let content = if active {
            let account_id =
                account_id.ok_or_else(|| app_err!("OAuth 配置必须绑定一个订阅账号"))?;
            Some(
                oauth
                    .codex_auth_json(account_id)
                    .await
                    .map_err(|error| app_err!("{error}"))?,
            )
        } else {
            None
        };

        let _operation = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        let previous_account = self.bound_account_id(id)?;
        self.set_profile_account(id, account_id)?;
        if let Some(content) = content {
            if let Err(error) = self.write_auth_json(&content) {
                let _ = self.database.set_profile_account(
                    id,
                    previous_account.as_deref(),
                    &now_ms().to_string(),
                );
                return Err(error);
            }
        }
        Ok(())
    }
}

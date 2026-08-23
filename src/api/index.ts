import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppState,
  AuthStatus,
  CodexAppStatus,
  DatabaseBackupInfo,
  DeviceCodeResponse,
  ManagedAccount,
  McpServerSpec,
  McpSyncPreview,
  PluginMarketplace,
  MarketplacePlugin,
  PluginSkill,
  PluginPreview,
  PluginSummary,
  PluginUpdate,
  SkillSummary,
  SkillCandidate,
  ProfileBalance,
  ProfileBalanceInfo,
  ProfileDetail,
  ProfileConnectionResult,
  ProfileSummary,
  RestartStage,
  Settings,
  TomlDiagnostic,
} from "../types";
import { webInvoke } from "./web-mock";

export const isTauri = typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

type RestartProgressHandler = (payload: { stage: RestartStage; message: string | null }) => void;

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return isTauri ? invoke<T>(command, args) : webInvoke<T>(command, args);
}

export const api = {
  getState: () => call<AppState>("get_state"),
  getCodexStatus: () => call<CodexAppStatus>("get_codex_status"),
  captureProfile: (name: string) => call<ProfileSummary>("capture_profile", { name }),
  addBuiltinProfile: (
    kind: string,
    baseUrl?: string,
    apiKey?: string,
    adminUrl?: string,
    accountId?: string,
  ) => call<ProfileSummary>("add_builtin_profile", { kind, baseUrl, apiKey, adminUrl, accountId }),
  addCustomProfile: (
    name: string,
    configText: string,
    baseUrl?: string,
    apiKey?: string,
    adminUrl?: string,
    catalogText?: string | null,
    authText?: string | null,
  ) =>
    call<ProfileSummary>("add_custom_profile", {
      name,
      configText,
      baseUrl,
      apiKey,
      adminUrl,
      catalogText,
      authText,
    }),
  getBuiltinCatalog: (kind: string) => call<string | null>("get_builtin_catalog", { kind }),
  testProfileConnection: (id: string, baseUrl?: string, apiKey?: string) =>
    call<ProfileConnectionResult>("test_profile_connection", { id, baseUrl, apiKey }),
  // 创建态表单测试：供应商尚未保存，直接用表单里的地址/密钥
  testProviderConnection: (baseUrl: string, apiKey: string) =>
    call<ProfileConnectionResult>("test_provider_connection", { baseUrl, apiKey }),
  getProfileBalance: (id: string) =>
    call<ProfileBalance>("get_profile_balance", { id }),
  exportDatabase: () => call<string>("export_database"),
  exportDatabaseTo: (directory: string) => call<string>("export_database_to", { directory }),
  importDatabase: (path: string) => call<void>("import_database", { path }),
  listDatabaseBackups: () => call<DatabaseBackupInfo[]>("list_database_backups"),
  restoreDatabase: (name: string) => call<void>("restore_database", { name }),
  deleteDatabaseBackup: (name: string) => call<void>("delete_database_backup", { name }),
  renameDatabaseBackup: (oldName: string, title: string) =>
    call<void>("rename_database_backup", { oldName, title }),
  renameProfile: (id: string, name: string) => call<void>("rename_profile", { id, name }),
  setProfileIcon: (id: string, icon: string | null) => call<void>("set_profile_icon", { id, icon }),
  setProfileShowBalance: (id: string, enabled: boolean) =>
    call<void>("set_profile_show_balance", { id, enabled }),
  setProfileBalance: (id: string, info: ProfileBalanceInfo) =>
    call<void>("set_profile_balance", { id, info }),
  setProfileAccount: (id: string, accountId: string | null) =>
    call<void>("set_profile_account", { id, accountId }),
  duplicateProfile: (id: string) => call<ProfileSummary>("duplicate_profile", { id }),
  getProfile: (id: string) => call<ProfileDetail>("get_profile", { id }),
  updateProfile: (id: string, name: string, baseUrl?: string, apiKey?: string, adminUrl?: string) =>
    call<ProfileSummary>("update_profile", { id, name, baseUrl, apiKey, adminUrl }),
  updateProfileConfig: (
    id: string,
    configText: string,
    catalogText: string | null,
    authText: string | null,
  ) => call<ProfileDetail>("update_profile_config", { id, configText, catalogText, authText }),
  patchChatgptContextConfig: (configText: string, enabled: boolean) =>
    call<string>("patch_chatgpt_context_config", { configText, enabled }),
  patchSystemProxyConfig: (configText: string, enabled: boolean) =>
    call<string>("patch_system_proxy_config", { configText, enabled }),
  validateToml: (text: string) => call<TomlDiagnostic[]>("validate_toml", { text }),
  formatToml: (text: string) => call<string>("format_toml", { text }),
  listPlugins: () => call<PluginSummary[]>("list_plugins"),
  listSkills: () => call<SkillSummary[]>("list_skills"),
  getSkillContent: (name: string) => call<string>("get_skill_content", { name }),
  getImportSkillContent: (sourcePath: string) => call<string>("get_import_skill_content", { sourcePath }),
  scanUnmanagedSkills: () => call<SkillCandidate[]>("scan_unmanaged_skills"),
  importSkill: (sourcePath: string) => call<void>("import_skill", { sourcePath }),
  enableSkill: (name: string) => call<void>("enable_skill", { name }),
  disableSkill: (name: string) => call<void>("disable_skill", { name }),
  deleteSkill: (name: string) => call<void>("delete_skill", { name }),
  listPluginSkills: (name: string, storePath?: string) => call<PluginSkill[]>("list_plugin_skills", { name, storePath }),
  listPluginMarketplaces: () => call<PluginMarketplace[]>("list_plugin_marketplaces"),
  listMarketplacePlugins: (marketplace: string, root?: string) => call<MarketplacePlugin[]>("list_marketplace_plugins", { marketplace, root }),
  addPluginMarketplace: (url: string) => call<PluginMarketplace>("add_plugin_marketplace", { url }),
  removePluginMarketplace: (name: string) => call<void>("remove_plugin_marketplace", { name }),
  installMarketplacePlugin: (marketplace: string, name: string) =>
    call<PluginSummary>("install_marketplace_plugin", { marketplace, name }),
  checkPluginUpdates: () => call<PluginUpdate[]>("check_plugin_updates"),
  upgradeMarketplacePlugin: (marketplace: string, name: string) =>
    call<void>("upgrade_marketplace_plugin", { marketplace, name }),
  previewPlugin: (url: string) => call<PluginPreview>("preview_plugin", { url }),
  installPlugin: (url: string, subPath: string | null) =>
    call<PluginSummary>("install_plugin", { url, subPath }),
  uninstallPlugin: (name: string) => call<void>("uninstall_plugin", { name }),
  deleteProfile: (id: string) => call<void>("delete_profile", { id }),
  reorderProfiles: (ids: string[]) => call<void>("reorder_profiles", { ids }),
  applyProfile: (id: string) => call<void>("apply_profile", { id }),
  listMcpServers: () => call<McpServerSpec[]>("list_mcp_servers"),
  // 创建表单预填用：优先数据库 MCP 镜像，首次无镜像时回退 live
  getMcpSectionToml: () => call<string>("get_mcp_section_toml"),
  // 显式恢复：数据库镜像写回 live config.toml，返回恢复数量
  restoreMcpFromDatabase: () => call<number>("restore_mcp_from_database"),
  // 显式导入：live 当前 MCP 段强制镜像进数据库，返回导入数量
  importMcpFromLive: () => call<number>("import_mcp_from_live"),
  // 同步预览：对比 live 与数据库镜像的 MCP 差异（只读），供同步前人工裁决
  mcpSyncPreview: () => call<McpSyncPreview>("mcp_sync_preview"),
  saveMcpServer: (originalName: string | null, spec: McpServerSpec, fragment?: string) =>
    call<void>("save_mcp_server", { originalName, spec, fragment }),
  // MCP 编辑页：读取 live 原始片段（含未建模键与注释），初始化编辑器用
  getMcpServerToml: (name: string) => call<string | null>("get_mcp_server_toml", { name }),
  // MCP 编辑页实时同步：表单建模字段写进片段（表单 → 编辑器）
  patchMcpFragment: (toml: string, spec: McpServerSpec) =>
    call<string>("patch_mcp_fragment", { toml, spec }),
  // MCP 编辑页实时同步：片段解析回建模字段（编辑器 → 表单）
  parseMcpFragment: (toml: string) => call<McpServerSpec>("parse_mcp_fragment", { toml }),
  deleteMcpServer: (name: string) => call<void>("delete_mcp_server", { name }),
  restartCodex: () => call<void>("restart_codex"),
  setWindowTheme: (dark: boolean) => call<void>("set_window_theme", { dark }),
  authStartLogin: () => call<DeviceCodeResponse>("auth_start_login"),
  authPollForAccount: (deviceCode: string) =>
    call<ManagedAccount | null>("auth_poll_for_account", { deviceCode }),
  authGetStatus: () => call<AuthStatus>("auth_get_status"),
  authRemoveAccount: (accountId: string) =>
    call<void>("auth_remove_account", { accountId }),
  openUrl: (url: string) => call<void>("open_url", { url }),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  openPath: (path: string) => call<void>("open_path", { path }),
  onRestartProgress: async (handler: RestartProgressHandler) => {
    if (!isTauri) return () => undefined;
    return listen("restart-progress", (event) =>
      handler(event.payload as { stage: RestartStage; message: string | null }),
    );
  },
};

import { ArrowLeft, Eye, EyeOff, ExternalLink, FileBraces, Info, KeyRound, Monitor, Pencil, Save, Settings, Wifi } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppSelect } from "../../components/AppSelect";
import { AppSwitch } from "../../components/AppSwitch";
import ConfigTextEditor, { type ConfigTextEditorHandle } from "../../components/ConfigTextEditor";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { ProfileIconTile } from "../../components/ProfileIconTile";
import {
  balanceQueryProviders,
  builtinPresets,
  customAuthTemplate,
  customCatalogTemplate,
  customConfigTemplate,
} from "../../presets";
import { patchProviderFields, readProviderFields, withMcpSection } from "./profileEditText";
import type { EditorDiagnosticSummary, ManagedAccount, ProfileDetail, ProfileSummary } from "../../types";
import ProfileIconEdit from "./ProfileIconEdit";

type EditTab = "config" | "auth" | "models";

interface ProfileEditProps {
  profile: ProfileSummary | null;
  create?: boolean;
  onBack: () => void;
  onChanged: () => void;
}

function hasLongContextOverride(text: string) {
  return /^\s*model_context_window\s*=/m.test(text) && /^\s*model_auto_compact_token_limit\s*=/m.test(text);
}

function hasSystemProxyOverride(text: string) {
  return /^\s*respect_system_proxy\s*=/m.test(text);
}

function normalizeNewlines(text: string) {
  return text.replace(/\r\n/g, "\n");
}

export default function ProfileEdit({ profile, create = false, onBack, onChanged }: ProfileEditProps) {
  const feedback = useFeedback();
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [name, setName] = useState(profile?.name ?? "");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [adminUrl, setAdminUrl] = useState("");
  const [authAccounts, setAuthAccounts] = useState<ManagedAccount[]>([]);
  const [externalAccount, setExternalAccount] = useState<ManagedAccount | null>(null);
  const [boundAccountId, setBoundAccountId] = useState<string | null>(null);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(profile?.icon ?? null);
  const [presetKind, setPresetKind] = useState(create ? "custom" : "");
  const [activeTab, setActiveTab] = useState<EditTab>("config");
  const [configText, setConfigText] = useState("");
  const [catalogText, setCatalogText] = useState("");
  const [authText, setAuthText] = useState("");
  const [configInitial, setConfigInitial] = useState("");
  const [catalogInitial, setCatalogInitial] = useState("");
  const [authInitial, setAuthInitial] = useState("");
  const [configTouched, setConfigTouched] = useState(false);
  const [catalogTouched, setCatalogTouched] = useState(false);
  const [longContextEnabled, setLongContextEnabled] = useState(false);
  const [patchingLongContext, setPatchingLongContext] = useState(false);
  const [systemProxyEnabled, setSystemProxyEnabled] = useState(false);
  const [patchingSystemProxy, setPatchingSystemProxy] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);
  const [editorDiagnostics, setEditorDiagnostics] = useState<EditorDiagnosticSummary>({ count: 0, firstLine: null });
  const [mcpSection, setMcpSection] = useState("");
  const initialized = useRef(false);
  const editorRef = useRef<ConfigTextEditorHandle>(null);

  const selectedPreset = useMemo(() => builtinPresets.find((preset) => preset.kind === presetKind) ?? null, [presetKind]);
  const isCustom = create && presetKind === "custom";
  const isOfficial = create ? presetKind === "chatgpt" : detail?.provider === null;
  const isOpenCode = create ? presetKind === "opencode" : detail?.provider === "opencode-go";
  const showProviderFields = create ? (isCustom || Boolean(selectedPreset?.base_url)) : Boolean(detail?.provider);
  const showLongContextOverride = isOfficial;
  const supportsBalance = balanceQueryProviders.has(detail?.provider ?? "");
  const hasProfileAuthOverride = !create && Boolean(detail?.raw_auth?.trim()) && !(authText !== authInitial && !authText.trim());
  const configDirty = normalizeNewlines(configText) !== normalizeNewlines(configInitial);
  const catalogDirty = normalizeNewlines(catalogText) !== normalizeNewlines(catalogInitial);
  const authDirty = normalizeNewlines(authText) !== normalizeNewlines(authInitial);
  const liveCatalogPath = useMemo(() => {
    const match = /^\s*model_catalog_json\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/m.exec(configText);
    return match ? match[1] ?? match[2] ?? match[3] ?? "" : "";
  }, [configText]);
  const catalogFileName = liveCatalogPath.split(/[\\/]/).pop() || "models.json";
  const formatTarget = activeTab === "config"
    ? { icon: Settings, label: "config.toml", title: "格式化 config.toml（TOML）" }
    : activeTab === "auth"
      ? { icon: FileBraces, label: "auth.json", title: "格式化 auth.json（JSON）" }
      : { icon: FileBraces, label: catalogFileName, title: `格式化 ${catalogFileName}（JSON）` };
  const FormatIcon = formatTarget.icon;
  const tabs = useMemo(() => {
    const list: { id: EditTab; label: string; title?: string }[] = [{ id: "config", label: "config.toml" }];
    if (liveCatalogPath) list.push({ id: "models", label: catalogFileName, title: liveCatalogPath });
    if (!create) list.push({ id: "auth", label: "auth.json" });
    else if (isCustom) list.push({ id: "auth", label: "auth.json" });
    return list;
  }, [catalogFileName, create, isCustom, liveCatalogPath]);
  const baseFragment = create ? selectedPreset?.fragment ?? "" : detail?.config_fragment ?? "";
  const liveConfigFragment = useMemo(() => {
    if (!baseFragment) return "";
    return withMcpSection(patchProviderFields(baseFragment, baseUrl, apiKey), mcpSection);
  }, [apiKey, baseFragment, baseUrl, mcpSection]);
  const canSave = !create || (isCustom ? Boolean(configText.trim()) : Boolean(selectedPreset));
  const accountOptions = [
    { label: externalAccount?.login ?? "自动选择账号", value: "" },
    ...authAccounts.map((account) => ({ label: account.login, value: account.id })),
  ];
  const renderAccountLabel = (option: { label: string; value: string }) => {
    const desktop = option.value === "" && Boolean(externalAccount);
    const Icon = desktop ? Monitor : KeyRound;
    return <span className="inline-flex min-w-0 items-center gap-2"><Icon className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" /><span className="shrink-0 text-xs font-medium text-[var(--text-secondary)]">{desktop ? "桌面端认证" : "OAuth 认证"}</span><span className="text-[var(--text-secondary)]">·</span><span className="truncate">{option.label}</span></span>;
  };

  const loadAuthStatus = async () => {
    try {
      const status = await api.authGetStatus();
      setAuthAccounts(status.accounts);
      setExternalAccount(status.external);
    } catch {
      setAuthAccounts([]);
      setExternalAccount(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (create) {
        let initialMcpSection = "";
        try { initialMcpSection = (await api.getMcpSectionToml()).trim(); setMcpSection(initialMcpSection); } catch { /* backend falls back on save */ }
        setPresetKind("custom");
        setName("自定义供应商");
        setSelectedIcon("custom");
        setConfigText(withMcpSection(customConfigTemplate, initialMcpSection));
        setCatalogText(customCatalogTemplate);
        setAuthText(customAuthTemplate);
        setConfigInitial(withMcpSection(customConfigTemplate, initialMcpSection));
        setCatalogInitial(customCatalogTemplate);
        setAuthInitial(customAuthTemplate);
      } else if (profile) {
        try {
          const loaded = await api.getProfile(profile.id);
          if (cancelled) return;
          setDetail(loaded);
          setName(loaded.name);
          setConfigText(loaded.raw_config ?? loaded.config_fragment);
          setCatalogText(loaded.raw_catalog ?? loaded.catalog_content ?? "");
          setAuthText(loaded.raw_auth ?? loaded.auth_content ?? "");
          setConfigInitial(loaded.raw_config ?? loaded.config_fragment);
          setCatalogInitial(loaded.raw_catalog ?? loaded.catalog_content ?? "");
          setAuthInitial(loaded.raw_auth ?? loaded.auth_content ?? "");
          setBaseUrl(loaded.base_url ?? "");
          setApiKey(loaded.api_key ?? "");
          setAdminUrl(loaded.admin_url ?? "");
          setSelectedIcon(loaded.icon);
          setBoundAccountId(loaded.account_id ?? "");
          setShowBalance(loaded.show_balance);
          setLongContextEnabled(loaded.provider === null && hasLongContextOverride(loaded.raw_config ?? loaded.config_fragment));
          setSystemProxyEnabled(hasSystemProxyOverride(loaded.raw_config ?? loaded.config_fragment));
        } catch (error) {
          setLoadError(String(error));
        }
      }
      await loadAuthStatus();
      if (!cancelled) initialized.current = true;
    })();
    return () => { cancelled = true; };
    // profile identity is fixed for this mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!create || !presetKind || isCustom) {
      if (create && !isCustom) setCatalogText("");
      return;
    }
    const preset = selectedPreset;
    if (!preset?.model_values.model_catalog_json) {
      setCatalogText("");
      return;
    }
    void api.getBuiltinCatalog(presetKind).then((text) => {
      setCatalogText(text ?? "");
      setCatalogInitial(text ?? "");
    }).catch(() => setCatalogText(""));
  }, [create, isCustom, presetKind, selectedPreset]);

  useEffect(() => {
    if (!initialized.current) return;
    setConfigText((current) => {
      const next = patchProviderFields(current, baseUrl, apiKey);
      return next === current ? current : next;
    });
  }, [apiKey, baseUrl]);

  useEffect(() => {
    if (!initialized.current) return;
    const fields = readProviderFields(configText);
    if (fields.found) {
      if (fields.base_url !== baseUrl) setBaseUrl(fields.base_url);
      if (!fields.tokenMasked) {
        const key = /^<.*>$/.test(fields.experimental_bearer_token) ? "" : fields.experimental_bearer_token;
        if (key !== apiKey) setApiKey(key);
      }
    }
  }, [configText]);

  useEffect(() => {
    if (create && configText !== liveConfigFragment) setConfigTouched(true);
    if (!patchingLongContext && showLongContextOverride) setLongContextEnabled(hasLongContextOverride(configText));
  }, [configText, create, liveConfigFragment, patchingLongContext, showLongContextOverride]);

  useEffect(() => {
    if (!initialized.current) return;
    if (!patchingSystemProxy) setSystemProxyEnabled(hasSystemProxyOverride(configText));
  }, [configText, patchingSystemProxy]);

  const selectPreset = (kind: string) => {
    const preset = builtinPresets.find((item) => item.kind === kind);
    if (!preset) return;
    setPresetKind(kind);
    setConfigTouched(false);
    setCatalogTouched(false);
    setName(preset.name);
    setBaseUrl(preset.base_url);
    setApiKey("");
    setAdminUrl(preset.admin_url ?? "");
    setSelectedIcon(preset.icon);
    const nextConfig = withMcpSection(patchProviderFields(preset.fragment, preset.base_url, ""), mcpSection);
    setConfigText(nextConfig);
    setConfigInitial(nextConfig);
    setLongContextEnabled(kind === "chatgpt" && hasLongContextOverride(nextConfig));
    setSystemProxyEnabled(hasSystemProxyOverride(nextConfig));
    setActiveTab("config");
    if (kind === "chatgpt") void loadAuthStatus();
  };

  const toggleLongContext = async (enabled: boolean) => {
    if (patchingLongContext) return;
    setPatchingLongContext(true);
    try {
      const next = await api.patchChatgptContextConfig(configText, enabled);
      setConfigText(next);
      setLongContextEnabled(enabled);
    } catch (error) {
      feedback.error(`更新长上下文配置失败：${String(error)}`);
    } finally {
      setPatchingLongContext(false);
    }
  };

  const toggleSystemProxy = async (enabled: boolean) => {
    if (patchingSystemProxy) return;
    setPatchingSystemProxy(true);
    try {
      const next = await api.patchSystemProxyConfig(configText, enabled);
      setConfigText(next);
      setSystemProxyEnabled(enabled);
    } catch (error) {
      feedback.error(`更新系统代理设置失败：${String(error)}`);
    } finally {
      setPatchingSystemProxy(false);
    }
  };

  const formatCurrentDocument = async () => {
    if (formatting || saving) return;
    const text = activeTab === "config" ? configText : activeTab === "auth" ? authText : catalogText;
    if (!text.trim()) { feedback.warning("当前文件没有内容"); return; }
    setFormatting(true);
    try {
      const formatted = activeTab === "config" ? await api.formatToml(text) : JSON.stringify(JSON.parse(text), null, 2);
      if (formatted === text) feedback.info(`${formatTarget.label} 格式无误，无需调整`);
      else {
        if (activeTab === "config") setConfigText(formatted);
        else if (activeTab === "auth") setAuthText(formatted);
        else setCatalogText(formatted);
        feedback.success(`${formatTarget.label} 格式化成功（保存后生效）`);
      }
    } catch (error) { feedback.error(`格式化失败：${String(error)}`); }
    finally { setFormatting(false); }
  };

  const testConnection = async () => {
    if (testing) return;
    if (!baseUrl.trim()) { feedback.warning("请填写调用地址"); return; }
    if (!apiKey.trim()) { feedback.warning("请先填写 API 密钥"); return; }
    setTesting(true);
    try {
      const result = create ? await api.testProviderConnection(baseUrl.trim(), apiKey.trim()) : await api.testProfileConnection(profile!.id, baseUrl.trim(), apiKey.trim());
      if (result.ok) feedback.success(`连接正常${result.latency_ms != null ? ` · ${result.latency_ms}ms` : ""}`);
      else feedback.error(`连接失败：${result.error ?? "未知错误"}`);
    } catch (error) { feedback.error(`测试失败：${String(error)}`); }
    finally { setTesting(false); }
  };

  const saveIcon = async (icon: string | null) => {
    if (saving) return;
    setSaving(true);
    try {
      if (create) setSelectedIcon(icon);
      else await api.setProfileIcon(profile!.id, icon);
      setSelectedIcon(icon);
      onChanged();
      setPickingIcon(false);
    } catch (error) { feedback.error(String(error)); }
    finally { setSaving(false); }
  };

  const toggleBalance = async (enabled: boolean) => {
    if (savingBalance || !profile) return;
    setShowBalance(enabled);
    setSavingBalance(true);
    try { await api.setProfileShowBalance(profile.id, enabled); }
    catch (error) { setShowBalance(!enabled); feedback.error(String(error)); }
    finally { setSavingBalance(false); }
  };

  const save = async () => {
    if (saving || !canSave) return;
    if (create && isCustom && !configText.trim()) { feedback.error("请填写 config.toml 内容"); return; }
    setSaving(true);
    try {
      if (create && isCustom) {
        await api.addCustomProfile(name.trim() || "自定义供应商", configText, baseUrl.trim() || undefined, apiKey.trim() || undefined, adminUrl.trim() || undefined, liveCatalogPath && catalogText.trim() ? catalogText : null, authText.trim() ? authText : null);
        feedback.success("自定义供应商已添加");
      } else if (create) {
        const created = await api.addBuiltinProfile(presetKind, baseUrl.trim() || undefined, apiKey.trim() || undefined, adminUrl.trim() || undefined, isOfficial ? boundAccountId || undefined : undefined);
        if (configTouched || catalogTouched) await api.updateProfileConfig(created.id, configText, liveCatalogPath ? catalogText || null : null, null);
        feedback.success("内置供应商已添加");
      } else {
        const hasProvider = Boolean(detail?.provider);
        await api.updateProfile(profile!.id, name, hasProvider ? baseUrl : undefined, hasProvider ? apiKey : undefined, adminUrl.trim() || undefined);
        await api.updateProfileConfig(profile!.id, configText, liveCatalogPath && catalogDirty ? catalogText || null : null, !create && authDirty ? authText : null);
        if (isOfficial) await api.setProfileAccount(profile!.id, boundAccountId || null);
        feedback.success("供应商已更新");
      }
      onChanged();
      onBack();
    } catch (error) { feedback.error(String(error)); }
    finally { setSaving(false); }
  };

  if (pickingIcon) return <ProfileIconEdit icon={selectedIcon} onBack={() => setPickingIcon(false)} onSave={(icon) => void saveIcon(icon)} />;

  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col" onKeyDown={(event) => { if (event.ctrlKey && event.key === "Enter") void save(); }}>
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header">
        <button type="button" className="apple-page-header apple-back-button" aria-label="返回" onClick={onBack}><ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" /><span className="apple-title">{create ? "新建供应商" : "编辑供应商"}</span></button>
      </div>
      <div className="apple-edit-content">
        {loadError ? <p className="muted mt-4 text-sm">{loadError}</p> : null}
        <div className="apple-group p-0">
          {create ? <div className="apple-panel-section"><div className="field-subtitle">选择供应商</div><div className="mt-3 grid gap-2 sm:grid-cols-3 md:grid-cols-6">
            {builtinPresets.map((preset) => <button key={preset.kind} type="button" className={`flex items-center gap-2.5 rounded-xl p-2.5 text-left transition-colors ${presetKind === preset.kind ? "shadow-[0_0_0_1px_var(--accent)] bg-[var(--selection-bg)]" : "shadow-[0_0_0_1px_var(--panel-ring)] hover:bg-black/3 dark:hover:bg-white/4"}`} aria-pressed={presetKind === preset.kind} onClick={() => selectPreset(preset.kind)}><ProfileIconTile name={preset.name} icon={preset.icon} size="xs" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold tracking-tight">{preset.name}</span><span className="muted meta-xs block truncate">{preset.model}{preset.base_url ? "" : preset.kind === "chatgpt" ? " · 认证登录" : " · 无需密钥"}</span></span></button>)}
          </div></div> : null}
          <div className="apple-panel-section">
            <div className="flex items-center gap-4"><button type="button" className="relative grid h-[61px] w-[61px] shrink-0 place-items-center rounded-[16px] transition-opacity hover:opacity-80" title="点击更换图标" aria-label="更换图标" onClick={() => setPickingIcon(true)}><ProfileIconTile name={detail?.name ?? name} icon={selectedIcon} size="fill" /><span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-white shadow" aria-hidden="true"><Pencil className="h-2.5 w-2.5" strokeWidth={2} /></span></button><div className="min-w-0 flex-1"><div className="field-label mb-1.5">名称</div><input className="app-input" maxLength={50} placeholder="供应商名称" value={name} onChange={(event) => setName(event.target.value)} /></div></div>
            {showProviderFields ? <><label className="field-label mb-1.5 mt-4 block">请求地址</label><input className="app-input" placeholder="https://api.example.com/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /><div className="mb-1.5 mt-4 flex items-center gap-2"><span className="field-label">API 密钥</span>{isOpenCode && create ? <button type="button" className="apple-inline-btn" onClick={() => void api.openUrl("https://opencode.ai/go?ref=APHY0DXATH").catch((error) => feedback.error(String(error)))}><ExternalLink className="h-3 w-3" strokeWidth={2} />获取 API 密钥</button> : null}<button type="button" className="apple-inline-btn" disabled={testing || !apiKey.trim() || !baseUrl.trim()} onClick={() => void testConnection()}>{testing ? <LoadingSpinner /> : <Wifi className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}测试连通</button></div><div className="app-input-action"><input className="app-input app-input--action" type={showApiKey ? "text" : "password"} placeholder="请输入 API 密钥" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><button type="button" className="app-input-action__button" aria-label={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"} title={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"} aria-pressed={showApiKey} onClick={() => setShowApiKey((visible) => !visible)}>{showApiKey ? <EyeOff className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> : <Eye className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}</button></div>{isOpenCode && create ? <p className="muted mt-2 flex items-start gap-1.5 text-xs"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />使用此链接订阅 OpenCode Go，首月只需 $5，并可获得额外的 $5 额度！</p> : null}</> : null}
            {isOfficial ? <div className="mt-4"><div className="field-subtitle mb-1.5">认证来源</div>{hasProfileAuthOverride ? <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--panel-ring)] bg-black/3 px-3 py-2.5 dark:bg-white/4"><div><div className="text-sm font-medium">配置内 auth.json</div><div className="muted mt-0.5 text-xs">应用时优先使用当前档案的认证文件</div></div><span className="text-xs font-medium text-accent">优先使用</span></div> : <AppSelect value={boundAccountId ?? ""} options={accountOptions} onChange={setBoundAccountId} placeholder={externalAccount ? "桌面端认证" : "自动选择账号"} renderLabel={renderAccountLabel} />}</div> : null}
            {(!create || selectedPreset?.base_url) ? <div className="mt-4"><div className="mb-1.5 flex items-center gap-1"><span className="field-label">官网地址</span><button type="button" className="grid h-4 w-4 place-items-center rounded-full text-accent transition-colors hover:bg-[var(--profile-chip-bg)] disabled:opacity-40" disabled={!adminUrl.trim()} onClick={() => void api.openUrl(adminUrl.trim()).catch((error) => feedback.error(String(error)))}><ExternalLink className="h-3.5 w-3.5" strokeWidth={2} /></button></div><input className="app-input" placeholder="https://console.example.com（可选）" value={adminUrl} onChange={(event) => setAdminUrl(event.target.value)} /></div> : null}
            {!create && supportsBalance ? <div className="mt-4 flex items-center justify-between gap-3"><div><div className="text-sm font-semibold">余额/用量查询</div><div className="muted mt-0.5 text-xs">窗口激活时自动刷新，点击数字手动刷新</div></div><AppSwitch checked={showBalance} onCheckedChange={(value) => void toggleBalance(value)} /></div> : null}
          </div>
            <div className="apple-panel-section flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-1">
                  {tabs.map((tab) => <button key={tab.id} type="button" className={`relative flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold transition-colors ${activeTab === tab.id ? "bg-[var(--selection-bg)] text-accent" : "muted hover:bg-black/5 dark:hover:bg-white/8"}`} aria-pressed={activeTab === tab.id} title={tab.title} onClick={() => { setActiveTab(tab.id); setEditorDiagnostics({ count: 0, firstLine: null }); }}>{tab.id === "config" ? <Settings className="h-3.5 w-3.5" strokeWidth={2} /> : <FileBraces className="h-3.5 w-3.5" strokeWidth={2} />}<span>{tab.label}</span>{((tab.id === "config" && configDirty) || (tab.id === "models" && catalogDirty) || (tab.id === "auth" && authDirty)) ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" /> : null}</button>)}
                </div>
                {activeTab === "config" ? (
                  <div className="flex items-center gap-2">
                    {showLongContextOverride ? (
                      <label className={`flex items-center gap-2 rounded-[10px] border px-2.5 py-1 text-xs transition-colors ${longContextEnabled ? "border-accent/30 bg-accent/10 text-accent" : "border-[var(--panel-ring)]"}`} title="可能降低模型性能并增加 Token 消耗，仅在需要时开启。">
                        <input type="checkbox" checked={longContextEnabled} disabled={patchingLongContext || saving} onChange={(event) => void toggleLongContext(event.target.checked)} />
                        <span className="whitespace-nowrap font-medium">1M 上下文窗口</span>
                      </label>
                    ) : null}
                    <label className={`flex items-center gap-2 rounded-[10px] border px-2.5 py-1 text-xs transition-colors ${systemProxyEnabled ? "border-accent/30 bg-accent/10 text-accent" : "border-[var(--panel-ring)]"}`} title="让 Codex 的网络请求遵循操作系统代理设置，重启 Codex 后生效。">
                      <input type="checkbox" checked={systemProxyEnabled} disabled={patchingSystemProxy || saving} onChange={(event) => void toggleSystemProxy(event.target.checked)} />
                      <span className="whitespace-nowrap font-medium">遵循系统代理</span>
                    </label>
                  </div>
                ) : null}
              </div>
              <div className="mt-4 flex flex-col pr-1">{activeTab === "config" ? <ConfigTextEditor ref={editorRef} value={configText} language="toml" placeholder={create ? "选择供应商后显示配置预览" : "编辑 config.toml 内容，保存后仅写入该供应商；应用时才生效。"} onChange={(value) => setConfigText(value)} onDiagnostics={setEditorDiagnostics} /> : activeTab === "auth" ? <><ConfigTextEditor ref={editorRef} value={authText} language="json" placeholder="认证文件（~/.codex/auth.json）。" onChange={setAuthText} onDiagnostics={setEditorDiagnostics} />{detail?.raw_auth ? <p className="muted mt-2 text-xs">已保存自定义认证：清空并保存即可移除，应用时写入 ~/.codex/auth.json。</p> : null}</> : <ConfigTextEditor ref={editorRef} value={catalogText} language="json" placeholder="模型目录文件不存在或无法读取。" onChange={setCatalogText} onDiagnostics={setEditorDiagnostics} />}</div>
            </div>
        </div>
      </div>
      <div className="apple-edit-toolbar apple-edit-toolbar--footer">{editorDiagnostics.count > 0 ? <button type="button" className="mr-auto flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-2.5 py-1 text-xs chip-danger" aria-live="polite" onClick={() => editorRef.current?.focusFirstDiagnostic()}><span className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]" />{editorDiagnostics.count} 个错误{editorDiagnostics.firstLine !== null ? ` · 第 ${editorDiagnostics.firstLine} 行` : ""}</button> : null}<button type="button" className="apple-action-button" disabled={saving} title={formatTarget.title} onClick={() => void formatCurrentDocument()}><FormatIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />格式化</button><button type="button" className="apple-action-button" onClick={onBack}>取消</button><button type="button" className="apple-action-button app-button--primary" disabled={saving || !canSave} onClick={() => void save()}><Save className="h-4 w-4" strokeWidth={2} />{saving ? "保存中…" : "保存"}</button></div>
    </section>
  );
}

import { ArrowLeft, Download, Eye, EyeOff, ExternalLink, FileBraces, Info, KeyRound, Monitor, Pencil, Save, Settings, Webhook, Wifi } from "lucide-react";
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
  builtinHasCatalog,
  builtinPresets,
  customCatalogTemplate,
  customConfigTemplate,
  usageQueryProviders,
} from "../../presets";
import { patchModelValue, patchProviderFields, readModelValue, readProviderFields, resolveAuthSource, withMcpSection } from "./profileEditText";
import type { EditorDiagnosticSummary, ManagedAccount, ProfileDetail, ProfileSummary } from "../../types";
import ProfileIconEdit from "./ProfileIconEdit";

type EditTab = "config" | "auth" | "models";

interface ProfileEditProps {
  profile: ProfileSummary | null;
  create?: boolean;
  onBack: () => void;
  onChanged: () => void;
  onManageChatgptAccounts: () => void;
}

const manageChatgptAccountsValue = "__manage_chatgpt_accounts__";
const defaultCompactTokenLimit = "900000";

function hasLongContextOverride(text: string) {
  return /^\s*model_context_window\s*=/m.test(text) && /^\s*model_auto_compact_token_limit\s*=/m.test(text);
}

// 阈值行格式：readCompactTokenLimit 解析与 replaceCompactTokenLimit 写入共用同一 pattern，二者不可漂移
const compactTokenLimitLine = /^(\s*model_auto_compact_token_limit\s*=\s*)(\d+)\s*$/m;

function readCompactTokenLimit(text: string) {
  return compactTokenLimitLine.exec(text)?.[2] ?? defaultCompactTokenLimit;
}

// 输入框实时联动：把配置文本里的阈值行替换为新值；键不存在时原样返回（由 blur 时的后端补丁兜底补写）
function replaceCompactTokenLimit(text: string, limit: number) {
  return text.replace(compactTokenLimitLine, `$1${limit}`);
}

function hasSystemProxyOverride(text: string) {
  return /^\s*respect_system_proxy\s*=/m.test(text);
}

// 仅匹配 [features.context_management] 段内的 experimental_mode = true；[^[] 保证不跨入下一个段头
function hasContextManagementOverride(text: string) {
  return /^\s*\[features\.context_management\]\s*\n[^[]*?^\s*experimental_mode\s*=\s*true\s*$/m.test(text);
}

function normalizeNewlines(text: string) {
  return text.replace(/\r\n/g, "\n");
}

export default function ProfileEdit({ profile, create = false, onBack, onChanged, onManageChatgptAccounts }: ProfileEditProps) {
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
  const [modelValue, setModelValue] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [adminUrl, setAdminUrl] = useState("");
  const [authAccounts, setAuthAccounts] = useState<ManagedAccount[]>([]);
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
  const [authPreviewOnly, setAuthPreviewOnly] = useState(false);
  const [authPreviewReady, setAuthPreviewReady] = useState(false);
  const [configTouched, setConfigTouched] = useState(false);
  const [catalogTouched, setCatalogTouched] = useState(false);
  const [longContextEnabled, setLongContextEnabled] = useState(false);
  const [compactTokenLimit, setCompactTokenLimit] = useState(defaultCompactTokenLimit);
  const [patchingLongContext, setPatchingLongContext] = useState(false);
  const [systemProxyEnabled, setSystemProxyEnabled] = useState(false);
  const [patchingSystemProxy, setPatchingSystemProxy] = useState(false);
  const [contextMgmtEnabled, setContextMgmtEnabled] = useState(false);
  const [patchingContextMgmt, setPatchingContextMgmt] = useState(false);
  const [showBalance, setShowBalance] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);
  const [editorDiagnostics, setEditorDiagnostics] = useState<EditorDiagnosticSummary>({ count: 0, firstLine: null });
  const [mcpSection, setMcpSection] = useState("");
  const initialized = useRef(false);
  const authPreviewRequest = useRef(0);
  const presetTemplateRequest = useRef(0);
  const editorRef = useRef<ConfigTextEditorHandle>(null);

  const selectedPreset = useMemo(() => builtinPresets.find((preset) => preset.kind === presetKind) ?? null, [presetKind]);
  const isCustom = create && presetKind === "custom";
  const isOfficial = create ? presetKind === "chatgpt" : detail?.provider === null;
  const isOpenCode = create ? presetKind === "opencode" : detail?.provider === "opencode-go";
  const showProviderFields = create ? (isCustom || Boolean(selectedPreset?.base_url)) : Boolean(detail?.provider);
  const showLongContextOverride = isOfficial;
  const supportsBalance = isOfficial || balanceQueryProviders.has(detail?.provider ?? "");
  const isUsageProvider = usageQueryProviders.has(detail?.provider ?? "");
  // 创建态下预设的 config 原文统一从后端取（单源真相），避免与 Rust 模板双份维护。
  // 与 configText 同源同时设置（selectPreset 内 await 后一起 set），防止异步晚到
  // 触发 configText !== liveConfigFragment 的误判
  const [presetFragment, setPresetFragment] = useState("");
  const authSource = create
    ? boundAccountId ? "oauth" : "desktop"
    : resolveAuthSource(detail);
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
  // auth.json 仅官方档有认证语义；第三方档只有携带历史 raw_auth 快照时才显示（防御旧数据）。
  const showAuthTab = create
    ? isCustom || (isOfficial && authSource === "desktop")
    : isOfficial || Boolean(detail?.raw_auth);
  const tabs = useMemo(() => {
    const list: { id: EditTab; label: string; title?: string }[] = [{ id: "config", label: "config.toml" }];
    if (liveCatalogPath) list.push({ id: "models", label: catalogFileName, title: liveCatalogPath });
    if (showAuthTab) list.push({ id: "auth", label: "auth.json" });
    return list;
  }, [catalogFileName, liveCatalogPath, showAuthTab]);
  const baseFragment = create ? presetFragment : detail?.config_fragment ?? "";
  const liveConfigFragment = useMemo(() => {
    if (!baseFragment) return "";
    return withMcpSection(patchProviderFields(baseFragment, baseUrl, apiKey), mcpSection);
  }, [apiKey, baseFragment, baseUrl, mcpSection]);
  const canSave = (!create || (isCustom ? Boolean(configText.trim()) : Boolean(selectedPreset))) && (!isOfficial || !authPreviewOnly || authPreviewReady);
  const accountOptions = [
    { label: "Codex登录", value: "" },
    ...authAccounts.map((account) => ({ label: account.login, value: account.id })),
    { label: "+ 添加或管理ChatGPT 账号", value: manageChatgptAccountsValue },
  ];
  const oauthAccountOptions = [
    ...authAccounts.map((account) => ({ label: account.login, value: account.id })),
    { label: "+ 添加或管理ChatGPT 账号", value: manageChatgptAccountsValue },
  ];
  const renderAccountLabel = (option: { label: string; value: string }) => {
    if (option.value === manageChatgptAccountsValue) {
      return <span className="font-medium text-accent">{option.label}</span>;
    }
    const desktop = option.value === "";
    const Icon = desktop ? Monitor : KeyRound;
    return <span className="inline-flex min-w-0 items-center gap-2"><Icon className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" /><span className="shrink-0 text-xs font-medium text-[var(--text-secondary)]">{desktop ? "Codex登录" : "OAuth登录"}</span>{desktop ? null : <><span className="text-[var(--text-secondary)]">·</span><span className="truncate">{option.label}</span></>}</span>;
  };
  const refreshAuthPreview = async (accountId: string) => {
    const requestId = ++authPreviewRequest.current;
    setAuthPreviewOnly(true);
    setAuthPreviewReady(false);
    try {
      const preview = await api.authPreview(accountId);
      if (requestId !== authPreviewRequest.current) return;
      setAuthText(preview ?? "");
      setAuthInitial(preview ?? "");
      setAuthPreviewReady(true);
    } catch {
      // 预览失败时保留当前内容，避免切换过程中出现错误提示或空白闪烁。
    }
  };
  const selectAccount = (value: string) => {
    if (value === manageChatgptAccountsValue) {
      onManageChatgptAccounts();
      return;
    }
    setBoundAccountId(value || null);
    if (create && value && activeTab === "auth") setActiveTab("config");
    if (!create && authSource === "oauth" && value) void refreshAuthPreview(value);
  };

  const loadAuthStatus = async () => {
    try {
      const status = await api.authGetStatus();
      setAuthAccounts(status.accounts);
    } catch {
      setAuthAccounts([]);
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
        setPresetFragment(customConfigTemplate);
        setCatalogText(customCatalogTemplate);
        setConfigInitial(withMcpSection(customConfigTemplate, initialMcpSection));
        setCatalogInitial(customCatalogTemplate);
        setModelValue("");
      } else if (profile) {
        try {
          const loaded = await api.getProfile(profile.id);
          if (cancelled) return;
          setDetail(loaded);
          setName(loaded.name);
          setConfigText(loaded.raw_config ?? loaded.config_fragment);
          setCatalogText(loaded.raw_catalog ?? loaded.catalog_content ?? "");
          setAuthText(loaded.raw_auth ?? "");
          setConfigInitial(loaded.raw_config ?? loaded.config_fragment);
          setCatalogInitial(loaded.raw_catalog ?? loaded.catalog_content ?? "");
          setAuthInitial(loaded.raw_auth ?? "");
          setBaseUrl(loaded.base_url ?? "");
          setApiKey(loaded.api_key ?? "");
          setModelValue(readModelValue(loaded.raw_config ?? loaded.config_fragment) ?? "");
          setFetchedModels(loaded.fetched_models);
          setAdminUrl(loaded.admin_url ?? "");
          setSelectedIcon(loaded.icon);
          setBoundAccountId(loaded.account_id);
          setShowBalance(loaded.show_balance);
          setLongContextEnabled(loaded.provider === null && hasLongContextOverride(loaded.raw_config ?? loaded.config_fragment));
          setCompactTokenLimit(readCompactTokenLimit(loaded.raw_config ?? loaded.config_fragment));
          setSystemProxyEnabled(hasSystemProxyOverride(loaded.raw_config ?? loaded.config_fragment));
          setContextMgmtEnabled(hasContextManagementOverride(loaded.raw_config ?? loaded.config_fragment));
          if (loaded.provider === null) {
            const source = resolveAuthSource(loaded);
            if (source === "oauth") {
              setAuthPreviewOnly(true);
              if (loaded.account_id) {
                await refreshAuthPreview(loaded.account_id);
              } else {
                setAuthPreviewReady(false);
              }
            } else {
              setAuthPreviewOnly(false);
              setAuthPreviewReady(true);
            }
          }
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
    if (!builtinHasCatalog(presetKind)) {
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

  // 表单模型值 ↔ 编辑器顶层 model 行 双向同步（与地址/密钥同一模式）
  useEffect(() => {
    if (!initialized.current) return;
    setConfigText((current) => {
      const next = patchModelValue(current, modelValue);
      return next === current ? current : next;
    });
  }, [modelValue]);

  useEffect(() => {
    if (!initialized.current) return;
    const model = readModelValue(configText);
    if (model !== null && model !== modelValue) setModelValue(model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configText]);

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
    if (!patchingLongContext && showLongContextOverride) {
      setLongContextEnabled(hasLongContextOverride(configText));
      setCompactTokenLimit(readCompactTokenLimit(configText));
    }
  }, [configText, create, liveConfigFragment, patchingLongContext, showLongContextOverride]);

  useEffect(() => {
    if (!initialized.current) return;
    if (!patchingSystemProxy) setSystemProxyEnabled(hasSystemProxyOverride(configText));
  }, [configText, patchingSystemProxy]);

  useEffect(() => {
    if (!initialized.current) return;
    if (!patchingContextMgmt) setContextMgmtEnabled(hasContextManagementOverride(configText));
  }, [configText, patchingContextMgmt]);

  const selectPreset = async (kind: string) => {
    const preset = builtinPresets.find((item) => item.kind === kind);
    if (!preset) return;
    // 模板取回后才一次性更新全部状态：避免"表单已切、configText 未切"的中间渲染
    // 触发 configText !== liveConfigFragment 的 configTouched 误判
    const requestId = ++presetTemplateRequest.current;
    let template: string;
    try {
      template = kind === "custom" ? customConfigTemplate : await api.getBuiltinConfig(kind);
    } catch (error) {
      if (requestId === presetTemplateRequest.current) feedback.error(`读取内置模板失败：${String(error)}`);
      return;
    }
    if (requestId !== presetTemplateRequest.current) return;
    setPresetKind(kind);
    if (kind !== "chatgpt") setBoundAccountId(null);
    setConfigTouched(false);
    setCatalogTouched(false);
    setAuthText("");
    setAuthInitial("");
    setName(preset.name);
    setBaseUrl(preset.base_url);
    setApiKey("");
    setModelValue(preset.model);
    setFetchedModels([]);
    setAdminUrl(preset.admin_url ?? "");
    setSelectedIcon(preset.icon);
    setPresetFragment(template);
    const nextConfig = withMcpSection(patchProviderFields(template, preset.base_url, ""), mcpSection);
    setConfigText(nextConfig);
    setConfigInitial(nextConfig);
    setLongContextEnabled(kind === "chatgpt" && hasLongContextOverride(nextConfig));
    setCompactTokenLimit(readCompactTokenLimit(nextConfig));
    setSystemProxyEnabled(hasSystemProxyOverride(nextConfig));
    setContextMgmtEnabled(hasContextManagementOverride(nextConfig));
    setActiveTab("config");
    if (kind === "chatgpt") void loadAuthStatus();
  };

  const toggleLongContext = async (enabled: boolean) => {
    if (patchingLongContext) return;
    setPatchingLongContext(true);
    try {
      const next = await api.patchChatgptContextConfig(configText, enabled, Number(compactTokenLimit));
      setConfigText(next);
      setLongContextEnabled(enabled);
    } catch (error) {
      feedback.error(`更新长上下文配置失败：${String(error)}`);
    } finally {
      setPatchingLongContext(false);
    }
  };

  const updateCompactTokenLimit = async () => {
    const limit = Number(compactTokenLimit);
    if (patchingLongContext || !Number.isInteger(limit) || limit < 1 || limit > 1_000_000) {
      feedback.error("压缩阈值必须在 1 到 1000000 Token 之间");
      setCompactTokenLimit(readCompactTokenLimit(configText));
      return;
    }
    setPatchingLongContext(true);
    try {
      const next = await api.patchChatgptContextConfig(configText, true, limit);
      setConfigText(next);
    } catch (error) {
      feedback.error(`更新压缩阈值失败：${String(error)}`);
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

  const toggleContextManagement = async (enabled: boolean) => {
    if (patchingContextMgmt) return;
    setPatchingContextMgmt(true);
    try {
      const next = await api.patchContextManagementConfig(configText, enabled);
      setConfigText(next);
      setContextMgmtEnabled(enabled);
    } catch (error) {
      feedback.error(`更新上下文管理配置失败：${String(error)}`);
    } finally {
      setPatchingContextMgmt(false);
    }
  };

  const formatCurrentDocument = async () => {
    if (formatting || saving) return;
    if (activeTab === "auth" && authPreviewOnly) { feedback.info("认证预览不可编辑"); return; }
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

  const fetchModelList = async () => {
    if (fetchingModels) return;
    if (!baseUrl.trim()) { feedback.warning("请填写调用地址"); return; }
    if (!apiKey.trim()) { feedback.warning("请先填写 API 密钥"); return; }
    setFetchingModels(true);
    try {
      const models = await api.fetchProviderModels(baseUrl.trim(), apiKey.trim());
      setFetchedModels(models);
      if (!create && profile) await api.setProfileFetchedModels(profile.id, models);
      if (models.length === 0) feedback.info("接口未返回任何模型");
      else feedback.success(`获取到 ${models.length} 个模型，可在右侧下拉选择`);
    } catch (error) { feedback.error(`获取失败：${String(error)}`); }
    finally { setFetchingModels(false); }
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
        const created = await api.addCustomProfile(name.trim() || "自定义供应商", configText, baseUrl.trim() || undefined, apiKey.trim() || undefined, adminUrl.trim() || undefined, liveCatalogPath && catalogText.trim() ? catalogText : null, authText.trim() ? authText : null);
        if (fetchedModels.length) await api.setProfileFetchedModels(created.id, fetchedModels);
        feedback.success("自定义供应商已添加");
      } else if (create) {
        const created = await api.addBuiltinProfile(presetKind, baseUrl.trim() || undefined, apiKey.trim() || undefined, adminUrl.trim() || undefined, isOfficial ? boundAccountId || undefined : undefined);
        const customName = name.trim();
        if (customName && customName !== selectedPreset?.name) await api.renameProfile(created.id, customName);
        const authTextToSave = isOfficial && authSource === "desktop" && authDirty ? authText : null;
        if (configTouched || catalogTouched || authTextToSave !== null) {
          await api.updateProfileConfig(created.id, configText, liveCatalogPath ? catalogText || null : null, authTextToSave);
        }
        if (fetchedModels.length) await api.setProfileFetchedModels(created.id, fetchedModels);
        feedback.success("内置供应商已添加");
      } else {
        const hasProvider = Boolean(detail?.provider);
        await api.updateProfile(profile!.id, name, hasProvider ? baseUrl : undefined, hasProvider ? apiKey : undefined, adminUrl.trim() || undefined);
        const authTextToSave = isOfficial && authSource === "desktop" && authDirty ? authText : null;
        await api.updateProfileConfig(profile!.id, configText, liveCatalogPath && catalogDirty ? catalogText || null : null, authTextToSave);
        if (isOfficial && authSource === "oauth") {
          if (!boundAccountId) throw new Error("OAuth 配置必须绑定一个订阅账号");
          await api.setProfileAccount(profile!.id, boundAccountId);
        }
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
            {builtinPresets.map((preset) => <button key={preset.kind} type="button" className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${presetKind === preset.kind ? "shadow-[0_0_0_1px_var(--accent)] bg-(--selection-bg)" : "shadow-[0_0_0_1px_var(--panel-ring)] hover:bg-black/3 dark:hover:bg-white/4"}`} aria-pressed={presetKind === preset.kind} onClick={() => void selectPreset(preset.kind)}><ProfileIconTile name={preset.name} icon={preset.icon} size="xs" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold tracking-tight">{preset.name}</span></span></button>)}
          </div></div> : null}
          <div className="apple-panel-section">
            <div className="flex items-center gap-4"><button type="button" className="relative grid h-[61px] w-[61px] shrink-0 place-items-center rounded-[16px] transition-opacity hover:opacity-80" title="点击更换图标" aria-label="更换图标" onClick={() => setPickingIcon(true)}><ProfileIconTile name={detail?.name ?? name} icon={selectedIcon} size="fill" /><span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-accent text-white shadow" aria-hidden="true"><Pencil className="h-2.5 w-2.5" strokeWidth={2} /></span></button><div className="min-w-0 flex-1"><div className="field-label mb-1.5">名称</div><input className="app-input" maxLength={50} placeholder="供应商名称" value={name} onChange={(event) => setName(event.target.value)} /></div></div>
            {showProviderFields ? <><label className="field-label mb-1.5 mt-4 block">接口协议</label><div className="flex min-h-9 min-w-0 items-center gap-2 rounded-xl px-3 shadow-[0_0_0_1px_var(--panel-ring)]"><Webhook className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" /><span className="shrink-0 text-xs font-medium text-(--text-secondary)">Responses（原生）</span></div><label className="field-label mb-1.5 mt-4 block">请求地址</label><input className="app-input" placeholder="https://api.example.com/v1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /><div className="mb-1.5 mt-4 flex items-center gap-2"><span className="field-label">API 密钥</span>{isOpenCode && create ? <button type="button" className="apple-inline-btn" onClick={() => void api.openUrl("https://opencode.ai/go?ref=APHY0DXATH").catch((error) => feedback.error(String(error)))}><ExternalLink className="h-3 w-3" strokeWidth={2} />获取 API 密钥</button> : null}<button type="button" className="apple-inline-btn" disabled={testing || !apiKey.trim() || !baseUrl.trim()} onClick={() => void testConnection()}>{testing ? <LoadingSpinner /> : <Wifi className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}测试连通</button></div><div className="app-input-action"><input className="app-input app-input--action" type={showApiKey ? "text" : "password"} placeholder="请输入 API 密钥" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><button type="button" className="app-input-action__button" aria-label={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"} title={showApiKey ? "隐藏 API 密钥" : "显示 API 密钥"} aria-pressed={showApiKey} onClick={() => setShowApiKey((visible) => !visible)}>{showApiKey ? <EyeOff className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> : <Eye className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}</button></div><div className="mb-1.5 mt-4 flex items-center gap-2"><span className="field-label">模型</span><button type="button" className="apple-inline-btn" disabled={fetchingModels || !apiKey.trim() || !baseUrl.trim()} onClick={() => void fetchModelList()}>{fetchingModels ? <LoadingSpinner /> : <Download className="h-3 w-3" strokeWidth={2} aria-hidden="true" />}获取模型列表</button>{fetchedModels.length > 0 ? <span className="muted text-xs">{fetchedModels.length} 个可用</span> : null}</div><div className="flex gap-1.5"><input className="app-input min-w-0 flex-1" placeholder="模型 ID" value={modelValue} onChange={(event) => setModelValue(event.target.value)} /><div className="w-1/3 shrink-0"><AppSelect value={fetchedModels.includes(modelValue) ? modelValue : null} options={fetchedModels.map((id) => ({ label: id, value: id }))} onChange={(value) => setModelValue(value)} placeholder={fetchedModels.length ? "选择模型" : "请先获取模型列表"} /></div></div>{isOpenCode && create ? <p className="muted mt-2 flex items-start gap-1.5 text-xs"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />使用此链接订阅 OpenCode Go，首月只需 $5，并可获得额外的 $5 额度！</p> : null}</> : null}
            {isOfficial ? <div className="mt-4"><div className="field-subtitle mb-1.5">登录方式</div>{create ? <AppSelect value={boundAccountId ?? ""} options={accountOptions} onChange={selectAccount} placeholder="Codex登录" renderLabel={renderAccountLabel} /> : authSource === "oauth" ? <AppSelect value={boundAccountId ?? ""} options={oauthAccountOptions} onChange={selectAccount} placeholder="选择 OAuth 登录账号" renderLabel={renderAccountLabel} /> : <div className="flex min-h-9 min-w-0 items-center gap-2 rounded-xl px-3 shadow-[0_0_0_1px_var(--panel-ring)]"><Monitor className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" /><span className="shrink-0 text-xs font-medium text-[var(--text-secondary)]">Codex登录</span>{detail?.desktop_login ? <><span className="muted" aria-hidden="true">·</span><span className="min-w-0 truncate text-xs font-medium text-[var(--text-secondary)]" title={detail.desktop_login}>{detail.desktop_login}</span></> : null}</div>}</div> : null}
            {(!create || selectedPreset?.base_url) ? <div className="mt-4"><div className="mb-1.5 flex items-center gap-1"><span className="field-label">官网地址</span><button type="button" className="grid h-4 w-4 place-items-center rounded-full text-accent transition-colors hover:bg-(--profile-chip-bg) disabled:opacity-40" disabled={!adminUrl.trim()} onClick={() => void api.openUrl(adminUrl.trim()).catch((error) => feedback.error(String(error)))}><ExternalLink className="h-3.5 w-3.5" strokeWidth={2} /></button></div><input className="app-input" placeholder="https://console.example.com（可选）" value={adminUrl} onChange={(event) => setAdminUrl(event.target.value)} /></div> : null}
            {!create && supportsBalance ? <div className="mt-4 flex min-h-9 items-center justify-between gap-3 rounded-xl px-3 shadow-[0_0_0_1px_var(--panel-ring)]"><div className="flex min-w-0 items-center gap-2"><span className="text-sm font-semibold">{isOfficial ? "ChatGPT 额度显示" : isUsageProvider ? "用量查询" : "余额/用量查询"}</span><span className="muted truncate text-xs" title="窗口激活时自动刷新，点击数字手动刷新">窗口激活时自动刷新</span></div><AppSwitch checked={showBalance} onCheckedChange={(value) => void toggleBalance(value)} /></div> : null}
          </div>
            <div className="apple-panel-section flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <div className="flex gap-1">
                  {tabs.map((tab) => <button key={tab.id} type="button" className={`relative flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold transition-colors ${activeTab === tab.id ? "bg-(--selection-bg) text-accent" : "muted hover:bg-black/5 dark:hover:bg-white/8"}`} aria-pressed={activeTab === tab.id} title={tab.title} onClick={() => { setActiveTab(tab.id); setEditorDiagnostics({ count: 0, firstLine: null }); }}>{tab.id === "config" ? <Settings className="h-3.5 w-3.5" strokeWidth={2} /> : <FileBraces className="h-3.5 w-3.5" strokeWidth={2} />}<span>{tab.label}</span>{((tab.id === "config" && configDirty) || (tab.id === "models" && catalogDirty) || (tab.id === "auth" && authDirty)) ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" /> : null}</button>)}
                </div>
                {activeTab === "config" ? (
                  <div className="flex select-none items-center gap-2">
                    {showLongContextOverride ? (
                      <div className={`flex h-8 items-center overflow-hidden rounded-[10px] border text-xs transition-colors ${longContextEnabled ? "border-accent/30 bg-accent/10" : "border-[var(--panel-ring)]"}`}>
                        <label className={`flex h-full cursor-pointer items-center gap-2 px-2.5 transition-colors ${longContextEnabled ? "text-accent" : ""}`} title="可能降低模型性能并增加 Token 消耗，仅在需要时开启。">
                          <input type="checkbox" checked={longContextEnabled} disabled={patchingLongContext || saving} onChange={(event) => void toggleLongContext(event.target.checked)} />
                          <span className="whitespace-nowrap font-medium">1M 上下文窗口</span>
                        </label>
                        <label className={`flex h-full items-center gap-1.5 border-l border-[var(--panel-divider)] px-2.5 transition-opacity ${longContextEnabled ? "" : "opacity-40"}`} title="达到此 Token 数时自动压缩上下文。">
                          <span className="whitespace-nowrap">压缩阈值</span>
                          <input className="app-input app-input--compact compact-token-input h-6" type="number" min={1} max={1_000_000} step={1} inputMode="numeric" value={compactTokenLimit} disabled={!longContextEnabled || patchingLongContext || saving} onChange={(event) => {
                          const next = event.target.value;
                          setCompactTokenLimit(next);
                          // 实时联动编辑器：合法输入立即写入 configText，最终校验与格式化仍由 blur 时的后端补丁完成
                          const limit = Number(next);
                          if (!longContextEnabled || patchingLongContext || !Number.isInteger(limit) || limit < 1 || limit > 1_000_000) return;
                          setConfigText((current) => replaceCompactTokenLimit(current, limit));
                        }} onBlur={() => void updateCompactTokenLimit()} />
                        </label>
                      </div>
                    ) : null}
                    <label
                      className={`flex h-8 items-center gap-2 rounded-[10px] border px-2.5 text-xs transition-colors ${contextMgmtEnabled ? "border-accent/30 bg-accent/10 text-accent" : "border-[var(--panel-ring)]"}`}
                      title="上下文窗口滚动与 Token 预算提醒，需 ChatGPT 订阅登录官方后端，重启 Codex 后生效。"
                    >
                      <input type="checkbox" checked={contextMgmtEnabled} disabled={patchingContextMgmt || saving} onChange={(event) => void toggleContextManagement(event.target.checked)} />
                      <span className="whitespace-nowrap font-medium">上下文管理</span>
                      <span className="meta-xs muted">实验性</span>
                    </label>
                    <label className={`flex h-8 items-center gap-2 rounded-[10px] border px-2.5 text-xs transition-colors ${systemProxyEnabled ? "border-accent/30 bg-accent/10 text-accent" : "border-[var(--panel-ring)]"}`} title="让 Codex 的网络请求遵循操作系统代理设置，重启 Codex 后生效。">
                      <input type="checkbox" checked={systemProxyEnabled} disabled={patchingSystemProxy || saving} onChange={(event) => void toggleSystemProxy(event.target.checked)} />
                      <span className="whitespace-nowrap font-medium">使用系统代理</span>
                    </label>
                  </div>
                ) : null}
              </div>
              <div className="mt-4 flex flex-col">{activeTab === "config" ? <ConfigTextEditor ref={editorRef} value={configText} language="toml" placeholder={create ? "选择供应商后显示配置预览" : "编辑 config.toml 内容，保存后仅写入该供应商；应用时才生效。"} onChange={(value) => setConfigText(value)} onDiagnostics={setEditorDiagnostics} /> : activeTab === "auth" ? <ConfigTextEditor ref={editorRef} value={authText} language="json" readOnly={authPreviewOnly} placeholder="认证文件（~/.codex/auth.json）。" onChange={setAuthText} onDiagnostics={setEditorDiagnostics} /> : <ConfigTextEditor ref={editorRef} value={catalogText} language="json" placeholder="模型目录文件不存在或无法读取。" onChange={setCatalogText} onDiagnostics={setEditorDiagnostics} />}</div>
            </div>
        </div>
      </div>
      <div className="apple-edit-toolbar apple-edit-toolbar--footer">{editorDiagnostics.count > 0 ? <button type="button" className="mr-auto flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--danger)]/20 bg-(--danger)/10 px-2.5 py-1 text-xs chip-danger" aria-live="polite" onClick={() => editorRef.current?.focusFirstDiagnostic()}><span className="h-1.5 w-1.5 rounded-full bg-(--danger)" />{editorDiagnostics.count} 个错误{editorDiagnostics.firstLine !== null ? ` · 第 ${editorDiagnostics.firstLine} 行` : ""}</button> : null}<button type="button" className="apple-action-button" disabled={saving || (activeTab === "auth" && authPreviewOnly)} title={formatTarget.title} onClick={() => void formatCurrentDocument()}><FormatIcon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />格式化</button><button type="button" className="apple-action-button" onClick={onBack}>取消</button><button type="button" className="apple-action-button app-button--primary" disabled={saving || !canSave} onClick={() => void save()}><Save className="h-4 w-4" strokeWidth={2} />{saving ? "保存中…" : "保存"}</button></div>
    </section>
  );
}

import { ArrowLeft, Download, Blocks, ChevronRight, ExternalLink, Plus, RefreshCw, Search, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppSelect } from "../../components/AppSelect";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { TrashIcon } from "../../components/TrashIcon";
import type { MarketplacePlugin, PluginCandidate, PluginMarketplace, PluginPreview, PluginSkill, PluginSummary, PluginUpdate } from "../../types";

const containsLabels: Record<string, string> = {
  skills: "Skills",
  mcp: "MCP",
  app: "App",
  hooks: "Hook",
  agents: "Agent",
  commands: "命令",
};

const originLabels: Partial<Record<PluginSummary["origin"], string>> = {
  official: "官方目录",
  codex: "Codex 安装",
};

/** 可卸载的来源（官方市场与 Skill 注册表除外） */
const removableOrigins: readonly PluginSummary["origin"][] = ["codex"];

const originHints: Partial<Record<PluginSummary["origin"], string>> = {
  official: "官方市场，由 Codex 管理",
  codex: "启停请在 Codex 内操作",
};

const marketplaceKindLabels: Record<PluginMarketplace["kind"], string> = {
  official: "官方市场",
  "third-party": "第三方市场",
};

const recommendedMarketplaces = [
  {
    name: "openai-curated",
    displayName: "OpenAI Plugins",
    source: "openai/plugins",
    description: "OpenAI 官方 Codex 插件市场，提供可安装的应用集成与开发工作流。",
  },
  {
    name: "ponytail",
    displayName: "Ponytail",
    source: "DietrichGebert/ponytail",
    description: "偏向最小实现的开发工作流，强调 YAGNI、标准库和原生能力。",
  },
] as const;

let cachedPlugins: PluginSummary[] | null = null;

function ContainsChips({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <span className="flex shrink-0 flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="rounded-md bg-black/5 px-1.5 py-px font-medium tracking-wide muted meta-xs dark:bg-white/10">
          {containsLabels[item] ?? item}
        </span>
      ))}
    </span>
  );
}

function sourceUrl(source: string): string | null {
  const value = source.trim();
  if (/^https?:\/\//i.test(value)) return value.replace(/\.git$/i, "");
  const githubSsh = value.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(.+?)(?:\.git)?$/i);
  if (githubSsh) return `https://github.com/${githubSsh[1]}`;
  if (/^[^/\s]+\/[^/\s]+(?:@[^/\s]+)?$/.test(value)) {
    const [repository, reference] = value.split("@", 2);
    return `https://github.com/${repository}${reference ? `/tree/${reference}` : ""}`;
  }
  return null;
}

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.084-.729.084-.729 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.23 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.435.375.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.624-5.373-12-12-12" />
    </svg>
  );
}

function SourceLink({ source }: { source: string }) {
  const feedback = useFeedback();
  const url = sourceUrl(source);
  if (!url) return <span className="mono muted meta-xs break-all">{source}</span>;
  const isGithub = /github\.com/i.test(url);
  return (
    <button
      type="button"
      className="apple-inline-btn shrink-0"
      title={`打开来源：${url}`}
      aria-label={`打开${isGithub ? " GitHub" : "来源"}`}
      onClick={() => void api.openUrl(url).catch((error) => feedback.error(String(error)))}
    >
      {isGithub ? "GitHub" : "打开来源"}
      {isGithub ? <GithubMark /> : <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />}
    </button>
  );
}

function PluginDetailView({ plugin, onBack }: { plugin: PluginSummary; onBack: () => void }) {
  const [skills, setSkills] = useState<PluginSkill[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSkills([]);
    setSkillsLoaded(false);
    setSkillsError("");
    void api.listPluginSkills(plugin.name)
      .then((items) => {
        if (!cancelled) setSkills(items);
      })
      .catch((error) => {
        if (!cancelled) setSkillsError(String(error));
      })
      .finally(() => {
        if (!cancelled) setSkillsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [plugin.name]);

  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col">
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header">
        <button type="button" className="apple-page-header apple-back-button" aria-label="返回插件" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          <span className="apple-title">{plugin.display_name ?? plugin.name}</span>
        </button>
      </div>
      <div className="apple-edit-content">
        <div className="apple-group">
          <div className="apple-panel-section">
            <div className="flex flex-wrap items-center gap-2">
              <span className="title-md">{plugin.display_name ?? plugin.name}</span>
              {plugin.version ? <span className="apple-chip">v{plugin.version}</span> : null}
              {plugin.enabled ? null : <span className="apple-chip chip-warn">已禁用</span>}
            </div>
            {plugin.description ? <p className="muted mt-2 text-sm">{plugin.description}</p> : null}
          </div>
          <div className="apple-panel-section">
            <div className="field-label mb-2">插件介绍</div>
            {plugin.description ? <p className="muted text-sm">{plugin.description}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {plugin.category ? <span className="apple-chip">分类：{plugin.category}</span> : null}
              {plugin.capabilities.length ? <ContainsChips items={plugin.capabilities} /> : null}
            </div>
          </div>
          <div className="apple-panel-section">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="field-label mb-1.5">插件名</div>
                <div className="mono text-sm">{plugin.name}</div>
              </div>
              <div>
                <div className="field-label mb-1.5">来源</div>
                <div className="text-sm">{originLabels[plugin.origin] ?? plugin.origin}</div>
              </div>
              <div>
                <div className="field-label mb-1.5">市场</div>
                <div className="mono text-sm">{plugin.marketplace ?? "本地"}</div>
              </div>
              <div>
                <div className="field-label mb-1.5">安装位置</div>
                <div className="mono muted break-all text-sm">{plugin.store_path}</div>
              </div>
              {plugin.source_url ? (
                <div>
                  <div className="field-label mb-1.5">来源地址</div>
                  <SourceLink source={plugin.source_url} />
                </div>
              ) : null}
            </div>
          </div>
          <div className="apple-panel-section">
            <div className="field-label mb-2">插件组成</div>
            {plugin.contains.length ? <ContainsChips items={plugin.contains} /> : <p className="muted text-sm">未识别到组成内容</p>}
          </div>
          <div className="apple-panel-section">
            <div className="flex items-center justify-between gap-3">
              <div className="field-label">Skills</div>
              {skillsLoaded ? <span className="apple-chip" aria-label={`${skills.length} 个 Skill`}>{skills.length}</span> : null}
            </div>
            {!skillsLoaded ? (
              <div className="muted mt-3 flex items-center gap-2 text-sm"><LoadingSpinner />加载 Skill 明细…</div>
            ) : skillsError ? (
              <p className="muted mt-2 text-sm">{skillsError}</p>
            ) : skills.length ? (
              <div className="mt-3 space-y-2">
                {skills.map((skill) => (
                  <div key={skill.path} className="rounded-[var(--radius-control)] bg-black/3 p-3 shadow-[0_0_0_1px_var(--panel-ring)] dark:bg-white/4">
                    <div className="font-semibold">{skill.name}</div>
                    <div className="mono muted meta-xs mt-1 break-all">{skill.path}</div>
                    {skill.description ? <div className="muted mt-1.5 text-sm">{skill.description}</div> : null}
                  </div>
                ))}
              </div>
            ) : <p className="muted mt-2 text-sm">这个插件没有可读取的 Skill 明细。</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function MarketplaceDetailView({
  marketplace,
  onBack,
  onInstalled,
  updates,
  onUpgrade,
}: {
  marketplace: PluginMarketplace;
  onBack: () => void;
  onInstalled: () => Promise<void>;
  updates: PluginUpdate[];
  onUpgrade: (update: PluginUpdate) => Promise<void>;
}) {
  const feedback = useFeedback();
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState("");
  const [uninstalling, setUninstalling] = useState("");
  const [upgrading, setUpgrading] = useState("");
  const installedPluginCount = plugins.filter((plugin) => plugin.installed).length;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError("");
    void api.listMarketplacePlugins(marketplace.name, marketplace.root)
      .then((items) => {
        if (!cancelled) setPlugins(items);
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [marketplace.name]);

  const install = async (plugin: MarketplacePlugin) => {
    if (installing || uninstalling) return;
    setInstalling(plugin.name);
    try {
      await api.installMarketplacePlugin(marketplace.name, plugin.name);
      setPlugins((items) => items.map((item) => item.plugin_id === plugin.plugin_id ? { ...item, installed: true, enabled: true } : item));
      feedback.success(`已安装 ${plugin.name}，重启 Codex 后生效`);
      await onInstalled();
    } catch (reason) {
      feedback.error(String(reason));
    } finally {
      setInstalling("");
    }
  };

  const uninstall = async (plugin: MarketplacePlugin) => {
    if (uninstalling || installing) return;
    const confirmed = await feedback.confirm({
      title: "卸载插件",
      description: `确定卸载「${plugin.name}」吗？将通过 Codex CLI 移除插件文件。`,
      confirmText: "卸载",
      destructive: true,
    });
    if (!confirmed) return;
    setUninstalling(plugin.name);
    try {
      await api.uninstallPlugin(plugin.name);
      setPlugins((items) => items.map((item) => item.plugin_id === plugin.plugin_id ? { ...item, installed: false, enabled: false } : item));
      feedback.success(`已卸载 ${plugin.name}`);
      await onInstalled();
    } catch (reason) {
      feedback.error(String(reason));
    } finally {
      setUninstalling("");
    }
  };

  const upgrade = async (update: PluginUpdate) => {
    if (installing || uninstalling || upgrading) return;
    setUpgrading(update.name);
    try {
      await onUpgrade(update);
      setPlugins((items) => items.map((item) => item.plugin_id === `${update.name}@${update.marketplace}` ? { ...item, version: update.version } : item));
      feedback.success(`已升级 ${update.name}`);
      await onInstalled();
    } catch (reason) {
      feedback.error(String(reason));
    } finally {
      setUpgrading("");
    }
  };

  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col">
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header">
        <button type="button" className="apple-page-header apple-back-button" aria-label="返回插件市场" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          <span className="apple-title">{marketplace.display_name ?? marketplace.name}</span>
          {loaded ? <span className="apple-chip" aria-label={`${installedPluginCount} 个已安装插件`}>{installedPluginCount} 个已安装</span> : null}
        </button>
      </div>
      <div className="apple-edit-content">
        <div className="space-y-4">
          <div className="apple-group">
            <div className="apple-panel-section">
              <div className="flex flex-wrap items-center gap-2">
                <span className="title-md">{marketplace.display_name ?? marketplace.name}</span>
                <span className="apple-chip">{marketplaceKindLabels[marketplace.kind]}</span>
                {loaded ? <span className="apple-chip">{plugins.length} 个插件</span> : <LoadingSpinner />}
              </div>
              {marketplace.description ? <p className="muted mt-2 text-sm">{marketplace.description}</p> : null}
              {marketplace.source_url ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SourceLink source={marketplace.source_url} />
                </div>
              ) : null}
            </div>
          </div>
          <div className="apple-group">
            <div className="apple-panel-section">
              <div className="flex items-center gap-2">
                <div className="field-label">可浏览插件</div>
                {loaded ? <span className="apple-chip" aria-label={`${plugins.length} 个可浏览插件`}>{plugins.length}</span> : null}
              </div>
              {error ? <p className="muted mt-2 text-sm">{error}</p> : null}
              {loaded && !plugins.length && !error ? <p className="muted mt-2 text-sm">这个市场暂时没有可安装插件。</p> : null}
            </div>
            {!loaded ? [0, 1, 2].map((index) => (
              <div key={index} className="apple-panel-section apple-panel-section--compact" aria-busy="true" aria-label="正在加载插件">
                <div className="animate-pulse space-y-2">
                  <div className="h-4 w-36 rounded bg-black/5 dark:bg-white/10" />
                  <div className="h-3 w-2/3 rounded bg-black/5 dark:bg-white/10" />
                </div>
              </div>
            )) : plugins.map((plugin) => (
              <div key={plugin.plugin_id} className="apple-panel-section apple-panel-section--compact">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold">{plugin.display_name ?? plugin.name}</span>
                      {plugin.version ? <span className="apple-chip">v{plugin.version}</span> : null}
                      {plugin.installed ? <span className="apple-chip">已安装</span> : null}
                    </div>
                    {plugin.description ? <div className="muted mt-1 break-words text-sm">{plugin.description}</div> : null}
                    {(plugin.category || plugin.capabilities.length) ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {plugin.category ? <span className="apple-chip">分类：{plugin.category}</span> : null}
                      {plugin.capabilities.length ? <ContainsChips items={plugin.capabilities} /> : null}
                      </div>
                    ) : null}
                  </div>
                  {updates.some((item) => item.name === plugin.name && item.marketplace === marketplace.name) ? (
                    <button
                      type="button"
                      className="apple-action-button app-button--primary shrink-0"
                      disabled={Boolean(installing) || Boolean(uninstalling) || Boolean(upgrading)}
                      onClick={() => void upgrade(updates.find((item) => item.name === plugin.name && item.marketplace === marketplace.name)!)}
                    >
                      {upgrading === plugin.name ? <LoadingSpinner /> : <RefreshCw className="h-4 w-4" strokeWidth={2} />}
                      升级
                    </button>
                  ) : !plugin.installed || marketplace.kind === "third-party" ? (
                    <button
                      type="button"
                      className={`apple-action-button shrink-0 ${plugin.installed ? "app-button--danger" : "app-button--primary"}`}
                      disabled={Boolean(installing) || Boolean(uninstalling)}
                      onClick={() => void (plugin.installed ? uninstall(plugin) : install(plugin))}
                    >
                      {installing === plugin.name || uninstalling === plugin.name ? <LoadingSpinner /> : plugin.installed ? <TrashIcon /> : <Download className="h-4 w-4" strokeWidth={2} />}
                      {plugin.installed ? "卸载" : "安装"}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AddPluginView({
  onBack,
  onMarketplaceAdded,
  onInstalled,
}: {
  onBack: () => void;
  onMarketplaceAdded: (marketplace: PluginMarketplace) => void | Promise<void>;
  onInstalled: () => Promise<void>;
}) {
  const feedback = useFeedback();
  const [method, setMethod] = useState<"marketplace" | "repository">("marketplace");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [installing, setInstalling] = useState("");

  const addMarketplace = async () => {
    if (adding) return;
    if (!url.trim()) {
      feedback.warning("请先填写第三方插件市场地址");
      return;
    }
    setAdding(true);
    try {
      const marketplace = await api.addPluginMarketplace(url.trim());
      feedback.success(`已添加插件市场「${marketplace.name}」`);
      await onMarketplaceAdded(marketplace);
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setAdding(false);
    }
  };

  const openPreview = async () => {
    if (adding) return;
    if (!url.trim()) {
      feedback.warning("请先填写 GitHub 插件仓库地址");
      return;
    }
    setAdding(true);
    try {
      setPreview(await api.previewPlugin(url.trim()));
    } catch (error) {
      feedback.error(String(error));
      setPreview(null);
    } finally {
      setAdding(false);
    }
  };

  const install = async (candidate: PluginCandidate) => {
    if (installing) return;
    setInstalling(candidate.name);
    try {
      const summary = await api.installPlugin(url.trim(), candidate.sub_path || null);
      feedback.success(`已安装 ${summary.display_name ?? summary.name}，重启 Codex 后生效`);
      setPreview(null);
      await onInstalled();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setInstalling("");
    }
  };

  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col">
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header">
        <button type="button" className="apple-page-header apple-back-button" aria-label="返回插件市场" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          <span className="apple-title">添加插件</span>
        </button>
      </div>
      <div className="apple-edit-content">
        <div className="space-y-4">
          <div className="apple-group">
            <div className="apple-panel-section">
              <div className="field-label mb-1.5">添加方式</div>
              <AppSelect
                value={method}
                options={[
                  { label: "添加插件市场", value: "marketplace" as const },
                  { label: "从仓库安装单个插件", value: "repository" as const },
                ]}
                onChange={(value) => { setMethod(value); setPreview(null); }}
              />
              <div className="title-md mt-4">{method === "marketplace" ? "添加市场来源" : "GitHub 插件仓库"}</div>
              <p className="muted mt-2 text-sm">{method === "marketplace" ? "支持 GitHub 简写、Git/SSH 地址和本地市场目录；添加后由 Codex 识别并管理。" : "输入单个插件仓库地址；这不会添加市场来源。"}</p>
              <div className="mt-4 flex w-full flex-wrap items-center gap-2">
                <input
                  className="app-input min-w-0 flex-1"
                  placeholder={method === "marketplace" ? "owner/repo、https://...git 或本地市场目录" : "https://github.com/<owner>/<repo>（可带 /tree/<分支>/<子目录>）"}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) void (method === "marketplace" ? addMarketplace() : openPreview());
                  }}
                />
                <button type="button" className="apple-action-button app-button--primary" disabled={adding} onClick={() => void (method === "marketplace" ? addMarketplace() : openPreview())}>
                  {adding ? <LoadingSpinner /> : method === "marketplace" ? <Plus className="h-4 w-4" strokeWidth={2} /> : <Search className="h-4 w-4" strokeWidth={2} />}
                  {method === "marketplace" ? "添加插件市场" : "获取插件列表"}
                </button>
              </div>
            </div>
          </div>
          {method === "repository" && preview ? (
            <div className="apple-group">
              <div className="apple-panel-section">
                <div className="field-label">可安装插件</div>
                <p className="muted mt-1.5 text-sm">
                  仓库 <span className="mono">{preview.repo}</span> · 分支 <span className="mono">{preview.reference}</span>
                  {preview.reference !== preview.default_branch ? `（默认分支为 ${preview.default_branch}）` : ""}
                </p>
              </div>
              <div className="space-y-3">
                {preview.candidates.map((candidate) => (
                  <div key={candidate.sub_path || candidate.name} className="apple-panel-section">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">{candidate.display_name ?? candidate.name}</span>
                          {candidate.version ? <span className="apple-chip">v{candidate.version}</span> : null}
                        </div>
                        <div className="muted meta-xs truncate">{candidate.description ?? (candidate.sub_path || "仓库根目录")}</div>
                      </div>
                      <button type="button" className="apple-action-button app-button--primary" disabled={installing !== ""} onClick={() => void install(candidate)}>
                        {installing === candidate.name ? <LoadingSpinner /> : <Download className="h-4 w-4" strokeWidth={2} />}
                        安装
                      </button>
                    </div>
                    <div className="mt-2"><ContainsChips items={candidate.contains} /></div>
                    <details className="mt-2">
                      <summary className="muted meta-xs cursor-pointer select-none">文件清单（{candidate.files.length} 项）</summary>
                      <ul className="mono muted mt-1.5 flex flex-col gap-0.5">
                        {candidate.files.slice(0, 40).map((file) => <li key={file} className="truncate">{file}</li>)}
                        {candidate.files.length > 40 ? <li>…其余 {candidate.files.length - 40} 个文件</li> : null}
                      </ul>
                    </details>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PluginMarketplaceView({
  onBack,
  onInstalled,
}: {
  onBack: () => void;
  onInstalled: () => Promise<void>;
}) {
  const feedback = useFeedback();
  const [marketplaces, setMarketplaces] = useState<PluginMarketplace[]>([]);
  const [marketplacesLoaded, setMarketplacesLoaded] = useState(false);
  const [marketplacesError, setMarketplacesError] = useState("");
  const [adding, setAdding] = useState("");
  const [removing, setRemoving] = useState("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [upgradingAll, setUpgradingAll] = useState(false);
  const [updates, setUpdates] = useState<PluginUpdate[]>([]);
  const [selectedMarketplace, setSelectedMarketplace] = useState<PluginMarketplace | null>(null);
  const [showAddPlugin, setShowAddPlugin] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);

  const refreshMarketplaces = async () => {
    try {
      setMarketplaces(await api.listPluginMarketplaces());
      setMarketplacesError("");
    } catch (error) {
      setMarketplacesError(String(error));
    } finally {
      setMarketplacesLoaded(true);
    }
  };

  useEffect(() => { void refreshMarketplaces(); }, []);

  useEffect(() => {
    if (!selectedMarketplace && contentRef.current) contentRef.current.scrollTop = scrollTop.current;
  }, [selectedMarketplace]);

  const openMarketplace = (marketplace: PluginMarketplace) => {
    scrollTop.current = contentRef.current?.scrollTop ?? 0;
    setSelectedMarketplace(marketplace);
  };

  const browseRecommended = async (recommended: typeof recommendedMarketplaces[number]) => {
    const existing = marketplaces.find((marketplace) => marketplace.name === recommended.name);
    if (existing) {
      openMarketplace(existing);
      return;
    }
    if (adding) return;
    setAdding(recommended.name);
    try {
      const marketplace = await api.addPluginMarketplace(recommended.source);
      feedback.success(`已进入插件市场「${marketplace.name}」`);
      await refreshMarketplaces();
      openMarketplace(marketplace);
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setAdding("");
    }
  };

  const removeMarketplace = async (marketplace: PluginMarketplace) => {
    if (removing || marketplace.kind === "official") return;
    const confirmed = await feedback.confirm({
      title: "卸载第三方市场",
      description: `确定移除「${marketplace.name}」吗？只会移除市场来源，不会自动卸载其中已经安装的插件。`,
      confirmText: "卸载市场",
      destructive: true,
    });
    if (!confirmed) return;
    setRemoving(marketplace.name);
    try {
      await api.removePluginMarketplace(marketplace.name);
      feedback.success(`已卸载插件市场「${marketplace.name}」`);
      await refreshMarketplaces();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setRemoving("");
    }
  };

  const checkUpdates = async () => {
    if (checkingUpdates || upgradingAll) return;
    setCheckingUpdates(true);
    try {
      const items = await api.checkPluginUpdates();
      setUpdates(items);
      feedback.success(items.length ? `发现 ${items.length} 个可升级插件` : "第三方插件已是最新版本");
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const upgrade = async (update: PluginUpdate) => {
    await api.upgradeMarketplacePlugin(update.marketplace, update.name);
    setUpdates((items) => items.filter((item) => item.name !== update.name || item.marketplace !== update.marketplace));
  };

  const upgradeAll = async () => {
    if (!updates.length || upgradingAll || checkingUpdates) return;
    setUpgradingAll(true);
    try {
      for (const update of updates) await upgrade(update);
      feedback.success("第三方插件已全部升级");
      await onInstalled();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setUpgradingAll(false);
    }
  };

  if (selectedMarketplace) {
    return <MarketplaceDetailView marketplace={selectedMarketplace} onBack={() => setSelectedMarketplace(null)} onInstalled={onInstalled} updates={updates} onUpgrade={upgrade} />;
  }
  if (showAddPlugin) {
    return <AddPluginView onBack={() => setShowAddPlugin(false)} onMarketplaceAdded={async (marketplace) => { await refreshMarketplaces(); setShowAddPlugin(false); openMarketplace(marketplace); }} onInstalled={onInstalled} />;
  }

  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col">
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header">
        <button type="button" className="apple-page-header apple-back-button" aria-label="返回插件" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          <span className="apple-title">插件市场</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="apple-action-button" disabled={checkingUpdates || upgradingAll} onClick={() => void (updates.length ? upgradeAll() : checkUpdates())}>
            {checkingUpdates || upgradingAll ? <LoadingSpinner /> : <RefreshCw className="h-4 w-4" strokeWidth={2} />}
            {updates.length ? "全部升级" : "检查更新"}
          </button>
          <button type="button" className="apple-action-button app-button--primary" onClick={() => setShowAddPlugin(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            添加插件
          </button>
        </div>
      </div>
      <div ref={contentRef} className="apple-edit-content">
        <div className="space-y-4">
          <div className="apple-group">
            <div className="apple-panel-section">
              <div className="field-label">推荐市场</div>
              <p className="muted mt-2 text-sm">这些市场采用 Codex 官方 marketplace.json 规范，添加后进入目录即可浏览和安装。</p>
              <div className="mt-3 space-y-2">
                {recommendedMarketplaces.map((recommended) => {
                  const configured = marketplaces.find((marketplace) => marketplace.name === recommended.name);
                  return (
                    <div key={recommended.name} className="rounded-[var(--radius-control)] px-3 py-2.5 shadow-[0_0_0_1px_var(--panel-ring)]">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{recommended.displayName}</span>
                            {configured ? <span className="apple-chip">已安装</span> : null}
                          </div>
                          <div className="muted mt-1 break-words text-sm">{recommended.description}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="mono muted meta-xs break-all">{recommended.source}</span>
                            <SourceLink source={recommended.source} />
                          </div>
                        </div>
                        <button type="button" className="apple-action-button app-button--primary shrink-0" disabled={Boolean(adding) || !marketplacesLoaded} onClick={() => void browseRecommended(recommended)}>
                          {adding === recommended.name ? <LoadingSpinner /> : <ChevronRight className="h-4 w-4" strokeWidth={2} />}
                          {configured ? "浏览插件" : "添加并浏览"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="apple-group">
            <div className="apple-panel-section">
              <div className="flex items-center gap-2">
                <div className="field-label">已添加的插件市场</div>
                {marketplacesLoaded ? <span className="apple-chip" aria-label={`${marketplaces.length} 个已添加插件市场`}>{marketplaces.length}</span> : <LoadingSpinner />}
              </div>
              {marketplacesError ? <p className="muted mt-2 text-sm">{marketplacesError}</p> : null}
              {marketplaces.length ? (
                <div className="mt-3 space-y-2">
                  {marketplaces.map((marketplace) => (
                    <div key={marketplace.name} className="rounded-[var(--radius-control)] px-3 py-2.5 shadow-[0_0_0_1px_var(--panel-ring)]">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{marketplace.display_name ?? marketplace.name}</span>
                            <span className="apple-chip">{marketplaceKindLabels[marketplace.kind]}</span>
                            {marketplace.kind === "third-party" ? (
                              <button
                                type="button"
                                className="apple-icon-button text-[var(--danger)]/70 hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                                title="卸载市场"
                                aria-label={`卸载插件市场 ${marketplace.display_name ?? marketplace.name}`}
                                disabled={Boolean(removing)}
                                onClick={() => void removeMarketplace(marketplace)}
                              >
                                {removing === marketplace.name ? <LoadingSpinner /> : <TrashIcon />}
                              </button>
                            ) : null}
                          </div>
                          {marketplace.description ? <div className="muted mt-1 break-words text-sm">{marketplace.description}</div> : null}
                        </div>
                        <button type="button" className="apple-action-button shrink-0" onClick={() => openMarketplace(marketplace)}>
                          <ChevronRight className="h-4 w-4" strokeWidth={2} />
                          浏览插件
                        </button>
                      </div>
                      {marketplace.source_url ? (
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="mono muted meta-xs break-all">{marketplace.source_url}</span>
                          <SourceLink source={marketplace.source_url} />
                        </div>
                      ) : null}
                      <div className="mono muted meta-xs mt-1 break-all">{marketplace.root}</div>
                    </div>
                  ))}
                </div>
              ) : marketplacesLoaded && !marketplacesError ? <p className="muted mt-2 text-sm">暂未添加 Codex 插件市场。</p> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function PluginsView() {
  const feedback = useFeedback();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<PluginSummary | null>(null);
  const [addingMarketplace, setAddingMarketplace] = useState(false);

  const refresh = async () => {
    try {
      const items = await api.listPlugins();
      cachedPlugins = items;
      setPlugins(items);
      setLoadError("");
    } catch (error) {
      setLoadError(String(error));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    if (cachedPlugins) {
      setPlugins(cachedPlugins);
      setLoaded(true);
      return;
    }
    void refresh();
  }, []);

  const remove = async (plugin: PluginSummary) => {
    const confirmed = await feedback.confirm({
      title: "卸载插件",
      description: `确定卸载「${plugin.display_name ?? plugin.name}」吗？将通过 codex CLI 卸载（${plugin.marketplace ? `市场源 ${plugin.marketplace} 保留` : "市场源保留"}），之后可在 Codex 或这里重新安装。`,
      confirmText: "卸载",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await api.uninstallPlugin(plugin.name);
      feedback.success("插件已卸载");
      await refresh();
    } catch (error) {
      feedback.error(String(error));
    }
  };

  if (selectedPlugin) {
    return <PluginDetailView plugin={selectedPlugin} onBack={() => setSelectedPlugin(null)} />;
  }
  if (addingMarketplace) {
    return (
      <PluginMarketplaceView
        onBack={() => setAddingMarketplace(false)}
        onInstalled={refresh}
      />
    );
  }

  return (
    <section className="apple-scroll-page mx-auto w-full max-w-none">
      <header className="apple-page-bar flex-wrap justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-accent">
            <Blocks className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <div className="flex items-center gap-2">
            <div className="apple-title">插件</div>
            {loaded ? (
              <span className="apple-chip" aria-label={`${plugins.length} 个已安装插件`}>{plugins.length} 个已安装</span>
            ) : null}
          </div>
        </div>
        <button type="button" className="apple-action-button app-button--primary" onClick={() => setAddingMarketplace(true)}>
          <Store className="h-4 w-4" strokeWidth={2} />
          插件市场
          <span className="rounded-md bg-white/95 px-1.5 py-px font-bold tracking-wide text-accent meta-xs">Beta</span>
        </button>
      </header>
      <div className="apple-edit-content">
        {loadError ? <p className="muted mt-4 text-sm">{loadError}</p> : null}
        {loaded && plugins.length === 0 ? (
          <div className="apple-group py-14 text-center">
            <p className="muted">还没有安装插件。点击右上角「插件市场」添加第三方市场。</p>
          </div>
        ) : plugins.length ? (
          <div className="space-y-2">
            {plugins.map((plugin) => (
              <div key={plugin.name} className="apple-list-row">
                <button
                  type="button"
                  className="group min-w-0 flex-1 cursor-pointer text-left"
                  aria-label={`查看 ${plugin.display_name ?? plugin.name} 详情`}
                  title="点击查看详情"
                  onClick={() => setSelectedPlugin(plugin)}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-semibold transition-colors group-hover:text-accent">{plugin.display_name ?? plugin.name}</span>
                    {plugin.version ? (
                      <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-px font-medium tracking-wide muted meta-xs dark:bg-white/10">v{plugin.version}</span>
                    ) : null}
                    {originLabels[plugin.origin] ? (
                      <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-px font-medium tracking-wide muted meta-xs dark:bg-white/10">{originLabels[plugin.origin]}</span>
                    ) : null}
                    {plugin.enabled ? null : <span className="apple-chip chip-warn shrink-0">已禁用</span>}
                  </div>
                  <div className="muted meta-xs break-words">
                    {plugin.description ?? plugin.name}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <ContainsChips items={plugin.contains} />
                </div>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  {plugin.source_url ? <SourceLink source={plugin.source_url} /> : null}
                  {originHints[plugin.origin] ? (
                    <span className="muted meta-xs">{originHints[plugin.origin]}</span>
                  ) : null}
                  {removableOrigins.includes(plugin.origin) ? (
                    <button
                      type="button"
                      className="apple-icon-button text-[var(--danger)]/70 hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                      title="卸载"
                      aria-label={`卸载 ${plugin.name}`}
                      onClick={() => void remove(plugin)}
                    >
                      <TrashIcon />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

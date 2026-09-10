import { ArrowLeft, Download, Blocks, ChevronRight, ExternalLink, Plus, RefreshCw, Search, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { loadPlugins } from "../../app/managementDataCache";
import { AppDisclosure } from "../../components/AppDisclosure";
import { GithubMark } from "../../components/GithubMark";
import { AppSelect } from "../../components/AppSelect";
import { EmptyStateCard } from "../../components/EmptyStateCard";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { TrashIcon } from "../../components/TrashIcon";
import type { AppState, MarketplacePlugin, PluginCandidate, PluginMarketplace, PluginPreview, PluginSkill, PluginSummary, PluginUpdate } from "../../types";

type ContainsLabelKey = "contains.skills" | "contains.mcp" | "contains.app" | "contains.hooks" | "contains.agents" | "contains.commands";

/** 插件清单 contains / capabilities 的数据键 → 展示标签的 i18n 键（数据键本身不是界面文案）。 */
const containsLabels: Partial<Record<string, ContainsLabelKey>> = {
  skills: "contains.skills",
  mcp: "contains.mcp",
  app: "contains.app",
  hooks: "contains.hooks",
  agents: "contains.agents",
  commands: "contains.commands",
};

/** 插件来源数据值（official / codex）→ 展示标签的 i18n 键。 */
const originLabels: Partial<Record<PluginSummary["origin"], "origin.official" | "origin.thirdParty">> = {
  official: "origin.official",
  codex: "origin.thirdParty",
};

/** 可卸载的来源（官方市场与 Skill 注册表除外） */
const removableOrigins: readonly PluginSummary["origin"][] = ["codex"];

const marketplaceKindLabels: Record<PluginMarketplace["kind"], "origin.official" | "origin.thirdParty"> = {
  official: "origin.official",
  "third-party": "origin.thirdParty",
};

const recommendedMarketplaces = [
  {
    name: "openai-curated",
    // Codex 桌面端在不同渠道下会把官方精选市场物化为 openai-api-curated（~/.codex/.tmp/plugins）
    aliases: ["openai-api-curated"],
    displayName: "OpenAI Plugins",
    source: "openai/plugins",
    descriptionKey: "recommended.openaiCurated",
  },
  {
    name: "ponytail",
    aliases: [],
    displayName: "Ponytail",
    source: "DietrichGebert/ponytail",
    descriptionKey: "recommended.ponytail",
  },
] as const;

/// 推荐市场是否已配置：按市场名或别名匹配（官方市场在不同渠道下名称不同）。
function findConfiguredMarketplace(
  recommended: { name: string; aliases: readonly string[] },
  marketplaces: PluginMarketplace[],
): PluginMarketplace | undefined {
  return marketplaces.find(
    (marketplace) => marketplace.name === recommended.name || recommended.aliases.includes(marketplace.name),
  );
}

function ContainsChips({ items }: { items: string[] }) {
  const { t } = useTranslation("plugins");
  if (!items.length) return null;
  return (
    <span className="flex shrink-0 flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="rounded-md bg-black/5 px-1.5 py-px font-medium tracking-wide muted meta-xs dark:bg-white/10">
          {containsLabels[item] ? t(containsLabels[item]) : item}
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

function SourceLink({ source }: { source: string }) {
  const feedback = useFeedback();
  const { t } = useTranslation("plugins");
  const url = sourceUrl(source);
  if (!url) return <span className="mono muted meta-xs break-all">{source}</span>;
  const isGithub = /github\.com/i.test(url);
  return (
    <button
      type="button"
      className={isGithub ? "shrink-0 p-1 text-accent" : "apple-inline-btn shrink-0"}
      title={t("source.openTitle", { url })}
      aria-label={isGithub ? t("source.openGithub") : t("source.openSource")}
      onClick={() => void api.openUrl(url).catch((error) => feedback.error(String(error)))}
    >
      {isGithub ? <GithubMark /> : t("source.openSource")}
      {!isGithub && <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />}
    </button>
  );
}

function PluginDetailView({ plugin, onBack }: { plugin: PluginSummary; onBack: () => void }) {
  const { t } = useTranslation("plugins");
  const [skills, setSkills] = useState<PluginSkill[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSkills([]);
    setSkillsLoaded(false);
    setSkillsError("");
    void api.listPluginSkills(plugin.name, plugin.store_path)
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
        <button type="button" className="apple-page-header apple-back-button" aria-label={t("nav.backToPlugins")} onClick={onBack}>
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
              {plugin.enabled ? null : <span className="apple-chip chip-warn">{t("detail.disabled")}</span>}
            </div>
            {plugin.description ? <p className="muted mt-2 text-sm">{plugin.description}</p> : null}
          </div>
          <div className="apple-panel-section">
            <div className="field-label mb-2">{t("detail.intro")}</div>
            {plugin.description ? <p className="muted text-sm">{plugin.description}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {plugin.category ? <span className="apple-chip">{t("detail.category", { category: plugin.category })}</span> : null}
              {plugin.capabilities.length ? <ContainsChips items={plugin.capabilities} /> : null}
            </div>
          </div>
          <div className="apple-panel-section">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="field-label mb-1.5">{t("detail.origin")}</div>
                <div className="text-sm">{originLabels[plugin.origin] ? t(originLabels[plugin.origin]!) : plugin.origin}</div>
              </div>
              <div>
                <div className="field-label mb-1.5">{t("detail.marketplace")}</div>
                <div className="mono text-sm">{plugin.marketplace ?? t("detail.local")}</div>
              </div>
              <div>
                <div className="field-label mb-1.5">{t("detail.installPath")}</div>
                <div className="mono muted break-all text-sm">{plugin.store_path}</div>
              </div>
            </div>
          </div>
          <div className="apple-panel-section">
            <div className="field-label mb-2">{t("detail.composition")}</div>
            {plugin.contains.length ? <ContainsChips items={plugin.contains} /> : <p className="muted text-sm">{t("detail.compositionEmpty")}</p>}
          </div>
          <div className="apple-panel-section">
            <div className="flex items-center justify-between gap-3">
              <div className="field-label">Skills</div>
              {skillsLoaded ? <span className="apple-chip" aria-label={t("detail.skillCount", { count: skills.length })}>{skills.length}</span> : null}
            </div>
            {!skillsLoaded ? (
              <div className="muted mt-3 flex items-center gap-2 text-sm"><LoadingSpinner />{t("detail.loadingSkills")}</div>
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
            ) : <p className="muted mt-2 text-sm">{t("detail.skillsEmpty")}</p>}
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
  thirdPartyProfile,
}: {
  marketplace: PluginMarketplace;
  onBack: () => void;
  onInstalled: () => Promise<void>;
  updates: PluginUpdate[];
  onUpgrade: (update: PluginUpdate) => Promise<void>;
  thirdPartyProfile: boolean;
}) {
  const feedback = useFeedback();
  const { t } = useTranslation("plugins");
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
      feedback.success(t("toast.installed", { name: plugin.name }));
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
      title: t("confirm.uninstallPluginTitle"),
      description: t("confirm.removePlugin", { name: plugin.name }),
      confirmText: t("action.uninstall"),
      destructive: true,
    });
    if (!confirmed) return;
    setUninstalling(plugin.name);
    try {
      await api.uninstallPlugin(plugin.name);
      setPlugins((items) => items.map((item) => item.plugin_id === plugin.plugin_id ? { ...item, installed: false, enabled: false } : item));
      feedback.success(t("toast.uninstalled", { name: plugin.name }));
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
      feedback.success(t("toast.upgraded", { name: update.name }));
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
        <button type="button" className="apple-page-header apple-back-button" aria-label={t("nav.backToMarketplace")} onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          <span className="apple-title">{marketplace.display_name ?? marketplace.name}</span>
          {loaded ? <span className="apple-chip apple-chip--accent" aria-label={t("marketDetail.installedCountAria", { count: installedPluginCount })}>{t("marketDetail.installedCount", { count: installedPluginCount })}</span> : null}
        </button>
      </div>
      <div className="apple-edit-content">
        <div className="space-y-4">
          {thirdPartyProfile ? (
            <div className="apple-group">
              <div className="apple-panel-section">
                <p className="muted text-sm">
                  {t("marketDetail.thirdPartyNotice")}
                </p>
              </div>
            </div>
          ) : null}
          <div className="apple-group">
            <div className="apple-panel-section">
              <div className="flex flex-wrap items-center gap-2">
                <div className="field-label">{t("marketDetail.browsable")}</div>
                <span className="apple-chip">{t(marketplaceKindLabels[marketplace.kind])}</span>
                {loaded ? <span className="apple-chip" aria-label={t("marketDetail.browsableAria", { count: plugins.length })}>{plugins.length}</span> : <LoadingSpinner />}
              </div>
              {marketplace.description ? <p className="muted mt-2 text-sm">{marketplace.description}</p> : null}
              {marketplace.source_url ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SourceLink source={marketplace.source_url} />
                </div>
              ) : null}
              {error ? <p className="muted mt-2 text-sm">{error}</p> : null}
              {loaded && !plugins.length && !error ? <p className="muted mt-2 text-sm">{t("marketDetail.empty")}</p> : null}
            </div>
            {!loaded ? [0, 1, 2].map((index) => (
              <div key={index} className="apple-panel-section apple-panel-section--compact" aria-busy="true" aria-label={t("marketDetail.loadingAria")}>
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
                      {plugin.installed ? <span className="apple-chip apple-chip--accent">{t("marketDetail.installed")}</span> : null}
                    </div>
                    {plugin.description ? <div className="muted mt-1 break-words text-sm">{plugin.description}</div> : null}
                    {(plugin.category || plugin.capabilities.length || plugin.contains.length) ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {plugin.category ? <span className="apple-chip">{t("detail.category", { category: plugin.category })}</span> : null}
                        {plugin.capabilities.length ? <ContainsChips items={plugin.capabilities} /> : null}
                        {plugin.contains.length ? <ContainsChips items={plugin.contains} /> : null}
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
                      {t("action.upgrade")}
                    </button>
                  ) : !plugin.installed || marketplace.kind === "third-party" ? (
                    <button
                      type="button"
                      className={`apple-action-button shrink-0 ${plugin.installed ? "app-button--danger" : "app-button--primary"}`}
                      disabled={Boolean(installing) || Boolean(uninstalling)}
                      onClick={() => void (plugin.installed ? uninstall(plugin) : install(plugin))}
                    >
                      {installing === plugin.name || uninstalling === plugin.name ? <LoadingSpinner /> : plugin.installed ? <TrashIcon /> : <Download className="h-4 w-4" strokeWidth={2} />}
                      {plugin.installed ? t("action.uninstall") : t("action.install")}
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
  const { t } = useTranslation("plugins");
  const [method, setMethod] = useState<"marketplace" | "repository">("marketplace");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [installing, setInstalling] = useState("");

  const addMarketplace = async () => {
    if (adding) return;
    if (!url.trim()) {
      feedback.warning(t("add.missingMarketUrl"));
      return;
    }
    setAdding(true);
    try {
      const marketplace = await api.addPluginMarketplace(url.trim());
      feedback.success(t("add.added", { name: marketplace.name }));
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
      feedback.warning(t("add.missingRepoUrl"));
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
      feedback.success(t("toast.installed", { name: summary.display_name ?? summary.name }));
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
        <button type="button" className="apple-page-header apple-back-button" aria-label={t("nav.backToMarketplace")} onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          <span className="apple-title">{t("add.title")}</span>
        </button>
      </div>
      <div className="apple-edit-content">
        <div className="space-y-4">
          <div className="apple-group">
            <div className="apple-panel-section">
              <div className="field-label mb-1.5">{t("add.method")}</div>
              <AppSelect
                value={method}
                options={[
                  { label: t("add.methodMarketplace"), value: "marketplace" as const },
                  { label: t("add.methodRepository"), value: "repository" as const },
                ]}
                onChange={(value) => { setMethod(value); setPreview(null); }}
              />
              <div className="title-md mt-4">{method === "marketplace" ? t("add.marketSourceTitle") : t("add.repoTitle")}</div>
              <p className="muted mt-2 text-sm">{method === "marketplace" ? t("add.marketSourceHint") : t("add.repoHint")}</p>
              <div className="mt-4 flex w-full flex-wrap items-center gap-2">
                <input
                  className="app-input min-w-0 flex-1"
                  placeholder={method === "marketplace" ? t("add.marketPlaceholder") : t("add.repoPlaceholder")}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.nativeEvent.isComposing) void (method === "marketplace" ? addMarketplace() : openPreview());
                  }}
                />
                <button type="button" className="apple-action-button app-button--primary" disabled={adding} onClick={() => void (method === "marketplace" ? addMarketplace() : openPreview())}>
                  {adding ? <LoadingSpinner /> : method === "marketplace" ? <Plus className="h-4 w-4" strokeWidth={2} /> : <Search className="h-4 w-4" strokeWidth={2} />}
                  {method === "marketplace" ? t("add.methodMarketplace") : t("action.fetchList")}
                </button>
              </div>
            </div>
          </div>
          {method === "repository" && preview ? (
            <div className="apple-group">
              <div className="apple-panel-section">
                <div className="field-label">{t("add.candidates")}</div>
                <p className="muted mt-1.5 text-sm">
                  <Trans ns="plugins" i18nKey="add.repoSummary" values={{ repo: preview.repo, reference: preview.reference }} components={{ repo: <span className="mono" />, reference: <span className="mono" /> }} />
                  {preview.reference !== preview.default_branch ? t("add.defaultBranch", { branch: preview.default_branch }) : ""}
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
                        <div className="muted meta-xs truncate">{candidate.description ?? (candidate.sub_path || t("add.rootDir"))}</div>
                      </div>
                      <button type="button" className="apple-action-button app-button--primary" disabled={installing !== ""} onClick={() => void install(candidate)}>
                        {installing === candidate.name ? <LoadingSpinner /> : <Download className="h-4 w-4" strokeWidth={2} />}
                        {t("action.install")}
                      </button>
                    </div>
                    <div className="mt-2"><ContainsChips items={candidate.contains} /></div>
                    <details className="mt-2">
                      <summary className="muted meta-xs cursor-pointer select-none">{t("add.files", { count: candidate.files.length })}</summary>
                      <ul className="mono muted mt-1.5 flex flex-col gap-0.5">
                        {candidate.files.slice(0, 40).map((file) => <li key={file} className="truncate">{file}</li>)}
                        {candidate.files.length > 40 ? <li>{t("add.filesMore", { count: candidate.files.length - 40 })}</li> : null}
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
  thirdPartyProfile,
}: {
  onBack: () => void;
  onInstalled: () => Promise<void>;
  thirdPartyProfile: boolean;
}) {
  const feedback = useFeedback();
  const { t } = useTranslation("plugins");
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
  const [recommendedOpen, setRecommendedOpen] = useState(false);
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
    const existing = findConfiguredMarketplace(recommended, marketplaces);
    if (existing) {
      openMarketplace(existing);
      return;
    }
    if (adding) return;
    setAdding(recommended.name);
    try {
      const marketplace = await api.addPluginMarketplace(recommended.source);
      feedback.success(t("market.entered", { name: marketplace.name }));
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
      title: t("market.removeConfirmTitle"),
      description: t("market.removeConfirm", { name: marketplace.name }),
      confirmText: t("action.removeMarket"),
      destructive: true,
    });
    if (!confirmed) return;
    setRemoving(marketplace.name);
    try {
      await api.removePluginMarketplace(marketplace.name);
      feedback.success(t("market.removedToast", { name: marketplace.name }));
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
      feedback.success(items.length ? t("market.foundUpdates", { count: items.length }) : t("market.upToDate"));
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
      feedback.success(t("market.allUpgraded"));
      await onInstalled();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setUpgradingAll(false);
    }
  };

  if (selectedMarketplace) {
    return (
      <MarketplaceDetailView
        marketplace={selectedMarketplace}
        onBack={() => setSelectedMarketplace(null)}
        onInstalled={onInstalled}
        updates={updates}
        onUpgrade={upgrade}
        thirdPartyProfile={thirdPartyProfile}
      />
    );
  }
  if (showAddPlugin) {
    return <AddPluginView onBack={() => setShowAddPlugin(false)} onMarketplaceAdded={async (marketplace) => { await refreshMarketplaces(); setShowAddPlugin(false); openMarketplace(marketplace); }} onInstalled={onInstalled} />;
  }

  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col">
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header">
        <button type="button" className="apple-page-header apple-back-button" aria-label={t("nav.backToPlugins")} onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
          <span className="apple-title">{t("marketplace")}</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="apple-action-button" disabled={checkingUpdates || upgradingAll} onClick={() => void (updates.length ? upgradeAll() : checkUpdates())}>
            {checkingUpdates || upgradingAll ? <LoadingSpinner /> : <RefreshCw className="h-4 w-4" strokeWidth={2} />}
            {updates.length ? t("action.upgradeAll") : t("action.checkUpdates")}
          </button>
          <button type="button" className="apple-action-button app-button--primary" onClick={() => setShowAddPlugin(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t("add.title")}
          </button>
        </div>
      </div>
      <div ref={contentRef} className="apple-edit-content">
        <div className="space-y-4">
          <div className="apple-group">
            <div className="apple-panel-section">
              <AppDisclosure
                open={recommendedOpen}
                onOpenChange={setRecommendedOpen}
                summary={(
                  <span className="min-w-0">
                    <span className="field-label block">{t("market.recommendedTitle")}</span>
                    <span className="muted mt-1 block break-words text-sm">{t("market.recommendedHint")}</span>
                  </span>
                )}
              >
                <div className="mt-2 space-y-2">
                  {recommendedMarketplaces.map((recommended) => {
                    const configured = findConfiguredMarketplace(recommended, marketplaces);
                    return (
                      <div key={recommended.name} className="rounded-[var(--radius-control)] px-2.5 py-2 shadow-[0_0_0_1px_var(--panel-ring)]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{recommended.displayName}</span>
                              {configured ? <span className="apple-chip apple-chip--accent">{t("marketDetail.installed")}</span> : null}
                            </div>
                            <div className="muted mt-0.5 break-words text-sm">{t(recommended.descriptionKey)}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2">
                              <span className="mono muted meta-xs break-all">{recommended.source}</span>
                              <SourceLink source={recommended.source} />
                            </div>
                          </div>
                          <button type="button" className="apple-action-button app-button--primary shrink-0" disabled={Boolean(adding) || !marketplacesLoaded} onClick={() => void browseRecommended(recommended)}>
                            {adding === recommended.name ? <LoadingSpinner /> : <ChevronRight className="h-4 w-4" strokeWidth={2} />}
                            {configured ? t("action.browse") : t("action.addAndBrowse")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </AppDisclosure>
            </div>
          </div>
          <div className="apple-group">
            <div className="apple-panel-section">
              <div className="flex items-center gap-2">
                <div className="field-label">{t("market.addedTitle")}</div>
                {marketplacesLoaded ? <span className="apple-chip" aria-label={t("market.addedCountAria", { count: marketplaces.length })}>{marketplaces.length}</span> : <LoadingSpinner />}
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
                            <span className="apple-chip">{t(marketplaceKindLabels[marketplace.kind])}</span>
                            {marketplace.kind === "third-party" ? (
                              <button
                                type="button"
                                className="apple-icon-button text-[var(--danger)]/70 hover:bg-(--danger)/10 hover:text-[var(--danger)]"
                                title={t("action.removeMarket")}
                                aria-label={t("market.removeAria", { name: marketplace.display_name ?? marketplace.name })}
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
                          {t("action.browse")}
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
              ) : marketplacesLoaded && !marketplacesError ? <p className="muted mt-2 text-sm">{t("market.empty")}</p> : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function PluginsView({ state }: { state: AppState }) {
  const feedback = useFeedback();
  const { t } = useTranslation("plugins");
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedPlugin, setSelectedPlugin] = useState<PluginSummary | null>(null);
  const [addingMarketplace, setAddingMarketplace] = useState(false);
  const thirdPartyProfile =
    state.profiles.find((profile) => profile.id === state.active_profile_id)?.kind === "third_party";

  const refresh = async (force = false) => {
    try {
      const items = await loadPlugins(force);
      setPlugins(items);
      setLoadError("");
    } catch (error) {
      setLoadError(String(error));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const remove = async (plugin: PluginSummary) => {
    const confirmed = await feedback.confirm({
      title: t("confirm.uninstallPluginTitle"),
      description: t("list.removeConfirm", {
        name: plugin.display_name ?? plugin.name,
        source: plugin.marketplace ? t("list.sourceKeptMarket", { marketplace: plugin.marketplace }) : t("list.sourceKept"),
      }),
      confirmText: t("action.uninstall"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await api.uninstallPlugin(plugin.name);
      feedback.success(t("toast.uninstalled", { name: plugin.display_name ?? plugin.name }));
      await refresh(true);
    } catch (error) {
      feedback.error(String(error));
    }
  };

  const orderedPlugins = [...plugins].sort((left, right) => {
    const originOrder = Number(left.origin !== "codex") - Number(right.origin !== "codex");
    return originOrder || left.name.localeCompare(right.name);
  });

  if (selectedPlugin) {
    return <PluginDetailView plugin={selectedPlugin} onBack={() => setSelectedPlugin(null)} />;
  }
  if (addingMarketplace) {
    return (
      <PluginMarketplaceView
        onBack={() => setAddingMarketplace(false)}
        onInstalled={() => refresh(true)}
        thirdPartyProfile={thirdPartyProfile}
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
            <div className="apple-title">{t("title")}</div>
            {loaded ? (
              <span className="apple-chip apple-chip--accent" aria-label={t("marketDetail.installedCountAria", { count: plugins.length })}>{t("marketDetail.installedCount", { count: plugins.length })}</span>
            ) : <span className="text-accent" role="status" aria-label={t("marketDetail.loadingAria")}><LoadingSpinner size="md" /></span>}
          </div>
        </div>
        <button type="button" className="apple-action-button app-button--primary" onClick={() => setAddingMarketplace(true)}>
          <Store className="h-4 w-4" strokeWidth={2} />
          {t("marketplace")}
          <span className="rounded-full bg-white/95 px-1.5 py-px font-bold tracking-wide text-accent meta-xs">Beta</span>
        </button>
      </header>
      <div className="apple-edit-content">
        {loadError ? <p className="muted mt-4 text-sm">{loadError}</p> : null}
        {!loaded ? (
          <EmptyStateCard loading icon={<Blocks className="h-5 w-5" strokeWidth={1.8} />}>
            <p className="muted">{t("list.loading")}</p>
          </EmptyStateCard>
        ) : plugins.length === 0 ? (
          <EmptyStateCard icon={<Blocks className="h-5 w-5" strokeWidth={1.8} />}>
            <p className="muted">{t("list.empty")}</p>
          </EmptyStateCard>
        ) : plugins.length ? (
          <div className="space-y-2">
            {orderedPlugins.map((plugin) => (
              <div key={plugin.name} className="apple-list-row">
                <button
                  type="button"
                  className="group min-w-0 flex-1 cursor-pointer text-left"
                  aria-label={t("list.viewDetailAria", { name: plugin.display_name ?? plugin.name })}
                  title={t("list.viewDetailTitle")}
                  onClick={() => setSelectedPlugin(plugin)}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-semibold transition-colors group-hover:text-accent">{plugin.display_name ?? plugin.name}</span>
                    {plugin.version ? (
                      <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-px font-medium tracking-wide muted meta-xs dark:bg-white/10">v{plugin.version}</span>
                    ) : null}
                    {originLabels[plugin.origin] ? (
                      <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-px font-medium tracking-wide muted meta-xs dark:bg-white/10">{t(originLabels[plugin.origin]!)}</span>
                    ) : null}
                    {plugin.enabled ? null : <span className="apple-chip chip-warn shrink-0">{t("detail.disabled")}</span>}
                  </div>
                  <div className="muted meta-xs truncate">
                    {plugin.description ?? plugin.name}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <ContainsChips items={plugin.contains} />
                </div>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  {plugin.source_url ? <SourceLink source={plugin.source_url} /> : null}
                  {removableOrigins.includes(plugin.origin) ? (
                    <button
                      type="button"
                      className="apple-icon-button text-[var(--danger)]/70 hover:bg-(--danger)/10 hover:text-[var(--danger)]"
                      title={t("action.uninstall")}
                      aria-label={t("list.uninstallAria", { name: plugin.name })}
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

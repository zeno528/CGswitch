import { ArrowLeft, FolderOpen, PackagePlus, PackageSearch, Puzzle, Search, Trash2 } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, isTauri } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { getCachedSkills, loadSkills, setSkillsCache } from "../../app/managementDataCache";
import { AppDialog } from "../../components/AppDialog";
import { EmptyStateCard } from "../../components/EmptyStateCard";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { matchesQuery } from "../plugins/pluginMeta";
import type { SkillCandidate, SkillSummary, SkillTool } from "../../types";

let savedScrollTop = 0;
const MarkdownPreview = lazy(() => import("react-markdown"));

export function selectableSkillPaths(candidates: SkillCandidate[]) {
  return candidates.filter((candidate) => !candidate.has_content_conflict).map((candidate) => candidate.store_path);
}

export default function SkillsView({ activationEpoch }: { activationEpoch: number }) {
  const feedback = useFeedback();
  const { t } = useTranslation("skills");
  const cached = getCachedSkills();
  const [skills, setSkills] = useState<SkillSummary[]>(cached ?? []);
  const [loaded, setLoaded] = useState(cached !== null);
  const [importing, setImporting] = useState(false);
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const updateScanInFlight = useRef(false);
  const availableCount = candidates.length;

  const refresh = async (force = false) => {
    try { const next = await loadSkills(force); setSkills(next); setLoadError(""); }
    catch (error) { setLoadError(String(error)); }
    finally { setLoaded(true); }
  };
  const openImport = async () => {
    if (busy) return;
    setImporting(true);
    if (candidates.length) return;
    setBusy("scan");
    try { setCandidates(await api.scanUnmanagedSkills()); }
    catch (error) { feedback.error(String(error)); }
    finally { setBusy(null); }
  };
  const importCandidates = async (paths: string[]) => {
    if (busy || !paths.length) return;
    setBusy("import");
    try {
      let imported = 0;
      for (const path of paths) {
        imported += await api.importSkill(path);
      }
      const importedNames = new Set(candidates.filter((candidate) => paths.includes(candidate.store_path)).map((candidate) => candidate.name));
      setCandidates((current) => current.filter((candidate) => !importedNames.has(candidate.name)));
      if (imported) feedback.success(t("importedToast", { count: imported }));
      else feedback.warning(t("importedIdenticalToast"));
    } catch (error) { feedback.error(String(error)); }
    finally {
      await refresh(true);
      void scanForUpdates(); // 导入改变候选集，角标立即重扫，不等窗口重新聚焦
      setBusy(null);
    }
  };
  const importFromFolder = async () => {
    if (busy) return;
    try {
      let picked: string | null = null;
      if (isTauri) {
        const result = await openDialog({ title: t("importFolderDialogTitle"), directory: true, multiple: false });
        picked = typeof result === "string" ? result : null;
        if (!picked) return;
      }
      setBusy("folder");
      const imported = await api.importSkill(picked ?? "mock-folder-skill");
      if (imported) feedback.success(t("importedToast", { count: imported }));
      else feedback.warning(t("importedIdenticalToast"));
      setImporting(false);
      await refresh(true);
      void scanForUpdates(); // 文件夹导入改变候选集，角标立即重扫，不等窗口重新聚焦
    } catch (error) { feedback.error(String(error)); }
    finally { setBusy(null); }
  };
  const run = async (name: string, action: "enable" | "disable" | "delete", tool: SkillTool = "codex") => {
    if (busy) return;
    if (action === "delete" && !await feedback.confirm({ title: t("deleteDialogTitle"), description: t("deleteDialogDescription", { name }), confirmText: t("delete"), destructive: true })) return;
    setBusy(`${action}:${name}`);
    const previous = skills;
    if (action !== "delete") setSkills((current) => { const next = current.map((skill) => skill.name === name ? { ...skill, [tool === "claude" ? "claude_enabled" : "enabled"]: action === "enable" } : skill); setSkillsCache(next); return next; });
    try { if (action === "enable") await api.enableSkill(name, tool); if (action === "disable") await api.disableSkill(name, tool); if (action === "delete") { await api.deleteSkill(name); feedback.success(t("deletedToast")); await refresh(true); void scanForUpdates(); } }
    catch (error) { if (action !== "delete") { setSkillsCache(previous); setSkills(previous); } feedback.error(String(error)); }
    finally { setBusy(null); }
  };
  const openPreview = async (name: string) => {
    setPreviewName(name); setPreviewContent("");
    try { setPreviewContent(await api.getSkillContent(name)); }
    catch (error) { setPreviewContent(String(error)); }
  };
  const scanForUpdates = async () => {
    if (updateScanInFlight.current) return;
    updateScanInFlight.current = true;
    try { setCandidates(await api.scanUnmanagedSkills()); }
    catch { /* 后台扫描失败保留上次结果，导入按钮仍可手动触发完整扫描。 */ }
    finally { updateScanInFlight.current = false; }
  };

  // 缓存直出（localStorage 恢复）后静默强刷；无缓存时两次调用共享同一在途请求。
  useEffect(() => { void refresh(); void refresh(true); }, []);
  useEffect(() => { void scanForUpdates(); }, [activationEpoch]);
  useEffect(() => { const main = document.querySelector("main"); if (!main) return; main.scrollTop = savedScrollTop; return () => { savedScrollTop = main.scrollTop; }; }, []);

  if (importing) return <ImportPage candidates={candidates} busy={busy} onBack={() => setImporting(false)} onImport={(paths) => void importCandidates(paths)} onImportFolder={() => void importFromFolder()} />;
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const claudeEnabledCount = skills.filter((skill) => skill.claude_enabled).length;
  const visibleSkills = skills.filter((skill) => matchesQuery(skill, query));
  return <><section className="apple-scroll-page mx-auto w-full max-w-none"><header className="apple-page-bar flex-wrap justify-between gap-4"><div className="flex min-w-0 items-center gap-2.5"><span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-accent"><Puzzle className="h-[18px] w-[18px]" strokeWidth={2} /></span><div className="flex items-center gap-2"><div className="apple-title">Skill</div>{loaded ? <><span className="apple-chip">{t("installedCount", { count: skills.length })}</span><span className="apple-chip">{t("codexEnabledCount", { count: enabledCount })}</span><span className="apple-chip">{t("claudeEnabledCount", { count: claudeEnabledCount })}</span></> : <LoadingSpinner />}</div></div><div className="flex items-center gap-2"><div className="relative w-44 shrink-0"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--text-secondary)" strokeWidth={2} /><input type="search" className="app-input app-input--pill" placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} /></div><button type="button" className="apple-action-button app-button--primary relative" aria-label={availableCount ? t("importSkillAria", { count: availableCount }) : t("importSkill")} title={availableCount ? t("importSkillTitle", { count: availableCount }) : undefined} onClick={() => void openImport()}><PackagePlus className="h-4 w-4" />{t("importSkill")}{availableCount ? <span className="apple-count-badge" aria-hidden="true">{availableCount > 9 ? "9+" : availableCount}</span> : null}</button></div></header><div className="apple-edit-content">{loadError ? <p className="muted mt-4 text-sm">{loadError}</p> : null}{!skills.length ? <EmptyStateCard loading={!loaded} icon={<Puzzle className="h-5 w-5" strokeWidth={1.8} />}><p className="muted">{t("empty")}</p><button type="button" className="apple-inline-btn" onClick={() => void openImport()}>{t("importFromLocal")}</button></EmptyStateCard> : null}{skills.length ? <div className="apple-group apple-list-card">{visibleSkills.map((skill) => <SkillRow key={skill.name} skill={skill} busy={busy !== null} onRun={run} onPreview={openPreview} />)}</div> : null}</div></section><AppDialog open={previewName !== null} onOpenChange={(open) => { if (!open) setPreviewName(null); }} title={previewName ?? "Skill"} className="app-dialog-content--wide" footer={<button type="button" className="apple-action-button app-button--primary" onClick={() => setPreviewName(null)}>{t("done")}</button>}><Suspense fallback={<div className="flex h-[var(--dialog-preview-height)] flex-col items-center justify-center gap-2"><LoadingSpinner size="md" /><span className="muted meta-xs">{t("loadingPreview")}</span></div>}><div className="skill-markdown-preview h-[var(--dialog-preview-height)] overflow-auto">{previewContent ? <MarkdownPreview>{previewContent}</MarkdownPreview> : <div className="flex h-full flex-col items-center justify-center gap-2"><LoadingSpinner size="md" /><span className="muted meta-xs">{t("loading")}</span></div>}</div></Suspense></AppDialog></>;
}

function ImportPage({ candidates, busy, onBack, onImport, onImportFolder }: { candidates: SkillCandidate[]; busy: string | null; onBack: () => void; onImport: (paths: string[]) => void; onImportFolder: () => void }) {
  const { t, i18n } = useTranslation("skills");
  const [ignoredPaths, setIgnoredPaths] = useState<string[]>([]);
  const visibleCandidates = candidates.filter((candidate) => !ignoredPaths.includes(candidate.store_path));
  const importablePaths = selectableSkillPaths(visibleCandidates);
  const [preview, setPreview] = useState<SkillCandidate | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const openPreview = async (skill: SkillCandidate) => {
    setPreview(skill);
    setPreviewContent("");
    try { setPreviewContent(await api.getImportSkillContent(skill.store_path)); }
    catch (error) { setPreviewContent(String(error)); }
  };
  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col">
      <div className="apple-page-bar apple-edit-toolbar apple-edit-toolbar--header justify-between">
        <button type="button" className="apple-page-header apple-back-button" disabled={busy !== null} onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" />
          <span className="apple-title">{t("importPageTitle")}</span>
          <span className="apple-chip">{visibleCandidates.length}</span>
        </button>
        <button type="button" className="apple-action-button" disabled={busy !== null} onClick={onImportFolder}>
          <FolderOpen className="h-4 w-4" />{t("importFromFolder")}
        </button>
      </div>
      <div className="apple-edit-content">
        {busy === "scan" ? (
          <EmptyStateCard loading icon={<PackageSearch className="h-5 w-5" strokeWidth={1.8} />}>
            <p className="muted">{t("scanning")}</p>
          </EmptyStateCard>
        ) : visibleCandidates.length ? (
          <div className="apple-group apple-list-card">
            {visibleCandidates.map((skill) => (
              <div key={skill.store_path} className="apple-list-row gap-4">
                <span className="group min-w-0 flex-1">
                  <button type="button" className="max-w-full truncate align-bottom font-semibold transition-colors group-hover:text-accent" onClick={() => void openPreview(skill)}>{skill.name}</button>
                  <span className={`apple-chip ml-2 ${skill.is_update ? "text-accent" : ""}`}>{skill.is_update ? t("updateFound") : t("newCandidate")}</span>
                  <span className="apple-chip ml-2">{t("source", { source: skill.source })}</span>
                  {skill.has_content_conflict ? <span className="meta-xs ml-2 font-semibold text-[var(--warning)]">{t("conflict")}</span> : null}
                  {skill.description ? <span className="muted meta-xs mt-1 block truncate">{skill.description}</span> : null}
                  {skill.has_content_conflict ? <span className="muted meta-xs mt-1 block">{t("modifiedAt", { date: new Date(skill.modified_at * 1000).toLocaleString(i18n.language) })}</span> : null}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" className="apple-action-button mcp-diff-action-button" disabled={busy !== null} onClick={() => setIgnoredPaths((current) => [...current, skill.store_path])}>{t("ignore")}</button>
                  <button type="button" className="apple-action-button mcp-diff-action-button app-button--primary" disabled={busy !== null} onClick={() => onImport([skill.store_path])}>{t("importOne")}</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyStateCard icon={<PackageSearch className="h-5 w-5" strokeWidth={1.8} />}>
            <p className="muted">{t("noCandidates")}</p>
          </EmptyStateCard>
        )}
      </div>
      <div className="apple-edit-toolbar apple-edit-toolbar--footer">
        {visibleCandidates.some((skill) => skill.has_content_conflict) ? <span className="muted meta-xs mr-auto">{t("bulkSkipsConflicts")}</span> : null}
        <button type="button" className="apple-action-button" disabled={busy !== null} onClick={onBack}>{t("cancel")}</button>
        <button type="button" className="apple-action-button app-button--primary" disabled={busy !== null || !importablePaths.length} onClick={() => onImport(importablePaths)}>
          {busy === "import" ? t("importing") : t("importAll")}
        </button>
      </div>
      <AppDialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }} title={preview?.name ?? "Skill"} className="app-dialog-content--wide" footer={<button type="button" className="apple-action-button app-button--primary" onClick={() => setPreview(null)}>{t("done")}</button>}>
        <Suspense fallback={<div className="flex h-[var(--dialog-preview-height)] flex-col items-center justify-center gap-2"><LoadingSpinner size="md" /><span className="muted meta-xs">{t("loadingPreview")}</span></div>}>
          <div className="skill-markdown-preview h-[var(--dialog-preview-height)] overflow-auto">{previewContent ? <MarkdownPreview>{previewContent}</MarkdownPreview> : <div className="flex h-full flex-col items-center justify-center gap-2"><LoadingSpinner size="md" /><span className="muted meta-xs">{t("loading")}</span></div>}</div>
        </Suspense>
      </AppDialog>
    </section>
  );
}

function ChatGPTLogo({ active }: { active: boolean }) {
  // 单色标本色随底色：启用态用 --primary-button-text，深浅主题下各自落在高亮块上，无需反色滤镜
  return <svg viewBox="0 0 24 24" className={`h-4 w-4 ${active ? "text-(--primary-button-text)" : "text-[var(--text-secondary)] opacity-35"}`} fill="currentColor" fillRule="evenodd" aria-hidden="true"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" /></svg>;
}

function ClaudeLogo({ active }: { active: boolean }) {
  // 品牌本色：星芒恒为 Claude 橙（--brand-claude，主题不变量），启停状态靠底色与不透明度表达
  return <svg viewBox="0 0 24 24" className={`h-4 w-4 text-(--brand-claude) ${active ? "" : "opacity-40"}`} fill="currentColor" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" /></svg>;
}

function SkillRow({ skill, busy, onRun, onPreview }: { skill: SkillSummary; busy: boolean; onRun: (name: string, action: "enable" | "disable" | "delete", tool?: SkillTool) => Promise<void>; onPreview: (name: string) => void }) {
  const { t } = useTranslation("skills");
  return <div className="apple-list-row"><button type="button" className="group min-w-0 max-w-2/3 flex-1 cursor-pointer text-left" title={t("previewSkill")} onClick={() => void onPreview(skill.name)}><div className="font-semibold transition-colors group-hover:text-accent">{skill.name}</div>{skill.description ? <div className="muted meta-xs truncate">{skill.description}</div> : null}</button><div className="flex shrink-0 items-center gap-2"><button type="button" role="switch" className={`apple-icon-button ${skill.claude_enabled ? "app-button--primary" : "hover:bg-transparent"}`} aria-label={skill.claude_enabled ? t("toggleClaudeRemoveAria", { name: skill.name }) : t("toggleClaudeAddAria", { name: skill.name })} aria-checked={skill.claude_enabled} disabled={busy} onClick={() => void onRun(skill.name, skill.claude_enabled ? "disable" : "enable", "claude")}><ClaudeLogo active={skill.claude_enabled} /></button><button type="button" role="switch" className={`apple-icon-button ${skill.enabled ? "app-button--primary" : "hover:bg-transparent"}`} aria-label={skill.enabled ? t("toggleRemoveAria", { name: skill.name }) : t("toggleAddAria", { name: skill.name })} aria-checked={skill.enabled} disabled={busy} onClick={() => void onRun(skill.name, skill.enabled ? "disable" : "enable")}><ChatGPTLogo active={skill.enabled} /></button><button type="button" className="apple-icon-button text-[var(--danger)]/70 hover:bg-(--danger)/10 hover:text-[var(--danger)]" title={t("delete")} aria-label={t("deleteAria", { name: skill.name })} disabled={busy} onClick={() => void onRun(skill.name, "delete")}><Trash2 className="h-4 w-4" /></button></div></div>;
}

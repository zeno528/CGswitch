import { ArrowLeft, PackagePlus, PackageSearch, Puzzle, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { loadSkills, setSkillsCache } from "../../app/managementDataCache";
import { AppDialog } from "../../components/AppDialog";
import { EmptyStateCard } from "../../components/EmptyStateCard";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import type { SkillCandidate, SkillSummary } from "../../types";

let savedScrollTop = 0;
const MarkdownPreview = lazy(() => import("react-markdown"));

export function availableSkillCount(candidates: SkillCandidate[]) {
  return candidates.length;
}

export default function SkillsView({ cachedSkills, onSkillsChange, activationEpoch }: { cachedSkills: SkillSummary[] | null; onSkillsChange: (skills: SkillSummary[] | null) => void; activationEpoch: number }) {
  const feedback = useFeedback();
  const { t } = useTranslation("skills");
  const [skills, setSkills] = useState<SkillSummary[]>(cachedSkills ?? []);
  const [loaded, setLoaded] = useState(cachedSkills !== null);
  const [importing, setImporting] = useState(false);
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [loadError, setLoadError] = useState("");
  const [availableCount, setAvailableCount] = useState(0);
  const updateScanInFlight = useRef(false);

  const refresh = async (force = false) => {
    try { const next = await loadSkills(force); onSkillsChange(next); setSkills(next); setLoadError(""); }
    catch (error) { setLoadError(String(error)); }
    finally { setLoaded(true); }
  };
  const openImport = async () => {
    if (busy) return;
    setImporting(true); setBusy("scan"); setSelectedPaths([]);
    try { setCandidates(await api.scanUnmanagedSkills()); }
    catch (error) { feedback.error(String(error)); }
    finally { setBusy(null); }
  };
  const confirmImport = async () => {
    const selectedCandidates = selectedPaths.map((path) => candidates.find((candidate) => candidate.store_path === path));
    const duplicateName = selectedCandidates.filter((candidate): candidate is SkillCandidate => Boolean(candidate)).map((candidate) => candidate.name).find((name, index, names) => names.indexOf(name) !== index);
    if (duplicateName) { feedback.error(t("duplicateName", { name: duplicateName })); return; }
    setBusy("import");
    try {
      for (const candidate of selectedCandidates) { if (candidate) await api.importSkill(candidate.store_path); }
      feedback.success(t("importedToast", { count: selectedPaths.length }));
      setImporting(false);
      await refresh(true);
      void scanForUpdates(); // 导入改变候选集，角标立即重扫，不等窗口重新聚焦
    } catch (error) { feedback.error(String(error)); }
    finally { setBusy(null); }
  };
  const run = async (name: string, action: "enable" | "disable" | "delete") => {
    if (busy) return;
    if (action === "delete" && !await feedback.confirm({ title: t("deleteDialogTitle"), description: t("deleteDialogDescription", { name }), confirmText: t("delete"), destructive: true })) return;
    setBusy(`${action}:${name}`);
    const previous = skills;
    if (action !== "delete") setSkills((current) => { const next = current.map((skill) => skill.name === name ? { ...skill, enabled: action === "enable" } : skill); setSkillsCache(next); onSkillsChange(next); return next; });
    try { if (action === "enable") await api.enableSkill(name); if (action === "disable") await api.disableSkill(name); if (action === "delete") { await api.deleteSkill(name); feedback.success(t("deletedToast")); await refresh(true); void scanForUpdates(); } }
    catch (error) { if (action !== "delete") { setSkillsCache(previous); onSkillsChange(previous); setSkills(previous); } feedback.error(String(error)); }
    finally { setBusy(null); }
  };
  const toggle = (path: string) => setSelectedPaths((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]);
  const toggleAll = () => { const selectable = candidates.filter((candidate) => !candidate.has_content_conflict); setSelectedPaths((current) => current.filter((path) => selectable.some((candidate) => candidate.store_path === path)).length === selectable.length ? [] : selectable.map((candidate) => candidate.store_path)); };
  const openPreview = async (name: string) => {
    setPreviewName(name); setPreviewContent("");
    try { setPreviewContent(await api.getSkillContent(name)); }
    catch (error) { setPreviewContent(String(error)); }
  };
  const scanForUpdates = async () => {
    if (updateScanInFlight.current) return;
    updateScanInFlight.current = true;
    try { setAvailableCount(availableSkillCount(await api.scanUnmanagedSkills())); }
    catch { /* 后台扫描失败保留上次结果，导入按钮仍可手动触发完整扫描。 */ }
    finally { updateScanInFlight.current = false; }
  };

  useEffect(() => { if (cachedSkills) { setSkills(cachedSkills); setLoaded(true); return; } void refresh(); }, []);
  useEffect(() => { void scanForUpdates(); }, [activationEpoch]);
  useEffect(() => { const main = document.querySelector("main"); if (!main) return; main.scrollTop = savedScrollTop; return () => { savedScrollTop = main.scrollTop; }; }, []);

  if (importing) return <ImportPage candidates={candidates} selectedPaths={selectedPaths} busy={busy} onBack={() => setImporting(false)} onToggle={toggle} onToggleAll={toggleAll} onConfirm={() => void confirmImport()} />;
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  return <><section className="apple-scroll-page mx-auto w-full max-w-none"><header className="apple-page-bar justify-between gap-4"><div className="flex min-w-0 items-center gap-2.5"><span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-accent"><Puzzle className="h-[18px] w-[18px]" strokeWidth={2} /></span><div className="flex items-center gap-2"><div className="apple-title">Skill</div>{loaded ? <><span className="apple-chip">{skills.length}</span><span className="apple-chip">{t("enabledCount", { count: enabledCount })}</span></> : <LoadingSpinner />}</div></div><button type="button" className="apple-action-button app-button--primary relative" aria-label={availableCount ? t("importSkillAria", { count: availableCount }) : t("importSkill")} title={availableCount ? t("importSkillTitle", { count: availableCount }) : undefined} onClick={() => void openImport()}><PackagePlus className="h-4 w-4" />{t("importSkill")}{availableCount ? <span className="skill-update-badge" aria-hidden="true">{availableCount > 9 ? "9+" : availableCount}</span> : null}</button></header><div className="apple-edit-content">{loadError ? <p className="muted mt-4 text-sm">{loadError}</p> : null}{!skills.length ? <EmptyStateCard loading={!loaded} icon={<Puzzle className="h-5 w-5" strokeWidth={1.8} />}><p className="muted">{t("empty")}</p><button type="button" className="apple-inline-btn" onClick={() => void openImport()}>{t("importFromLocal")}</button></EmptyStateCard> : null}{skills.length ? <div className="space-y-2">{skills.map((skill) => <SkillRow key={skill.name} skill={skill} busy={busy !== null} onRun={run} onPreview={openPreview} />)}</div> : null}</div></section><AppDialog open={previewName !== null} onOpenChange={(open) => { if (!open) setPreviewName(null); }} title={previewName ?? "Skill"} footer={<button type="button" className="apple-action-button app-button--primary" onClick={() => setPreviewName(null)}>{t("done")}</button>}><Suspense fallback={<div className="flex h-[60vh] flex-col items-center justify-center gap-2"><LoadingSpinner size="md" /><span className="muted meta-xs">{t("loadingPreview")}</span></div>}><div className="skill-markdown-preview h-[60vh] overflow-auto">{previewContent ? <MarkdownPreview>{previewContent}</MarkdownPreview> : <div className="flex h-full flex-col items-center justify-center gap-2"><LoadingSpinner size="md" /><span className="muted meta-xs">{t("loading")}</span></div>}</div></Suspense></AppDialog></>;
}

function ImportPage({ candidates, selectedPaths, busy, onBack, onToggle, onToggleAll, onConfirm }: { candidates: SkillCandidate[]; selectedPaths: string[]; busy: string | null; onBack: () => void; onToggle: (path: string) => void; onToggleAll: () => void; onConfirm: () => void }) {
  const { t, i18n } = useTranslation("skills");
  const selectableCandidates = candidates.filter((candidate) => !candidate.has_content_conflict);
  const allSelected = selectableCandidates.length > 0 && selectableCandidates.every((candidate) => selectedPaths.includes(candidate.store_path));
  const [preview, setPreview] = useState<SkillCandidate | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const openPreview = async (skill: SkillCandidate) => {
    setPreview(skill);
    setPreviewContent("");
    try { setPreviewContent(await api.getImportSkillContent(skill.store_path)); }
    catch (error) { setPreviewContent(String(error)); }
  };
  return <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col"><div className="apple-page-bar apple-edit-toolbar apple-edit-toolbar--header justify-between"><button type="button" className="apple-page-header apple-back-button" onClick={onBack}><ArrowLeft className="h-4 w-4 shrink-0 text-accent" /><span className="apple-title">{t("importPageTitle")}</span><span className="apple-chip">{candidates.length}</span></button></div><div className="apple-edit-content">{busy === "scan" ? <EmptyStateCard loading icon={<PackageSearch className="h-5 w-5" strokeWidth={1.8} />}><p className="muted">{t("scanning")}</p></EmptyStateCard> : candidates.length ? <div className="space-y-2">{candidates.map((skill) => <div key={skill.store_path} className="apple-list-row cursor-pointer" role="checkbox" tabIndex={0} aria-checked={selectedPaths.includes(skill.store_path)} onClick={() => onToggle(skill.store_path)} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onToggle(skill.store_path); } }}><input type="checkbox" className="pointer-events-none h-4 w-4 shrink-0 accent-[var(--accent)]" tabIndex={-1} aria-hidden="true" checked={selectedPaths.includes(skill.store_path)} readOnly /><span className="min-w-0 flex-1"><button type="button" className="font-semibold hover:text-accent" onClick={(event) => { event.stopPropagation(); void openPreview(skill); }}>{skill.name}</button><span className={`apple-chip ml-2 ${skill.is_update ? "text-accent" : ""}`}>{skill.is_update ? t("updateFound") : t("newCandidate")}</span><span className="apple-chip ml-2">{t("source", { source: skill.source })}</span>{skill.has_content_conflict ? <span className="meta-xs ml-2 font-semibold text-[var(--warning)]">{t("conflict")}</span> : null}{skill.description ? <span className="muted meta-xs mt-1 block truncate">{skill.description}</span> : null}{skill.has_content_conflict ? <span className="muted meta-xs mt-1 block">{t("modifiedAt", { date: new Date(skill.modified_at * 1000).toLocaleString(i18n.language) })}</span> : null}</span></div>)}</div> : <EmptyStateCard icon={<PackageSearch className="h-5 w-5" strokeWidth={1.8} />}><p className="muted">{t("noCandidates")}</p></EmptyStateCard>}</div><div className="apple-edit-toolbar apple-edit-toolbar--footer"><button type="button" className="apple-action-button" disabled={busy !== null || candidates.length === 0} onClick={onToggleAll}>{allSelected ? t("deselectAll") : t("selectAll")}</button><button type="button" className="apple-action-button" disabled={busy !== null} onClick={onBack}>{t("cancel")}</button><button type="button" className="apple-action-button app-button--primary" disabled={busy !== null || selectedPaths.length === 0} onClick={onConfirm}>{busy === "import" ? t("importing") : t("importCount", { count: selectedPaths.length })}</button></div><AppDialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }} title={preview?.name ?? "Skill"} footer={<button type="button" className="apple-action-button app-button--primary" onClick={() => setPreview(null)}>{t("done")}</button>}><Suspense fallback={<div className="flex h-[60vh] flex-col items-center justify-center gap-2"><LoadingSpinner size="md" /><span className="muted meta-xs">{t("loadingPreview")}</span></div>}><div className="skill-markdown-preview h-[60vh] overflow-auto">{previewContent ? <MarkdownPreview>{previewContent}</MarkdownPreview> : <div className="flex h-full flex-col items-center justify-center gap-2"><LoadingSpinner size="md" /><span className="muted meta-xs">{t("loading")}</span></div>}</div></Suspense></AppDialog></section>;
}

function ChatGPTLogo({ active }: { active: boolean }) {
  return <svg viewBox="0 0 24 24" className={`h-4 w-4 ${active ? "text-white" : "text-[var(--text-secondary)] opacity-35"}`} fill="currentColor" fillRule="evenodd" aria-hidden="true"><path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" /></svg>;
}

function SkillRow({ skill, busy, onRun, onPreview }: { skill: SkillSummary; busy: boolean; onRun: (name: string, action: "enable" | "disable" | "delete") => Promise<void>; onPreview: (name: string) => void }) {
  const { t } = useTranslation("skills");
  return <div className="apple-list-row"><button type="button" className="min-w-0 max-w-2/3 flex-1 cursor-pointer text-left" title={t("previewSkill")} onClick={() => void onPreview(skill.name)}><div className="font-semibold hover:text-accent">{skill.name}</div>{skill.description ? <div className="muted meta-xs truncate">{skill.description}</div> : null}</button><div className="flex shrink-0 items-center gap-2"><button type="button" role="switch" className={`apple-icon-button ${skill.enabled ? "app-button--primary" : "hover:bg-transparent"}`} aria-label={skill.enabled ? t("toggleRemoveAria", { name: skill.name }) : t("toggleAddAria", { name: skill.name })} aria-checked={skill.enabled} disabled={busy} onClick={() => void onRun(skill.name, skill.enabled ? "disable" : "enable")}><ChatGPTLogo active={skill.enabled} /></button><button type="button" className="apple-icon-button text-[var(--danger)]/70 hover:bg-(--danger)/10 hover:text-[var(--danger)]" title={t("delete")} aria-label={t("deleteAria", { name: skill.name })} disabled={busy} onClick={() => void onRun(skill.name, "delete")}><Trash2 className="h-4 w-4" /></button></div></div>;
}

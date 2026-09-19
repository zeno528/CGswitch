import { Camera, GripVertical, Layers2, Play, Plus, RefreshCw } from "lucide-react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../../api";
import { authQuotaErrorKind, profileAuthQuotaCacheKey } from "../../app/authQuotaCache";
import { useFeedback } from "../../app/Feedback";
import { AppDialog } from "../../components/AppDialog";
import { EmptyStateCard } from "../../components/EmptyStateCard";
import type { AppState, ProfileBalanceInfo, ProfileSummary } from "../../types";
import ProfileCard, { getCachedProfileBalance, getCachedProfileBalanceError, ProfileCardActions, ProfileCardContent } from "./ProfileCard";
import ProfileEdit from "./ProfileEdit";
import { UpdateNotice } from "../updates/AppUpdateProvider";

interface ProfilesViewProps {
  state: AppState;
  authStatusReady: boolean;
  activationEpoch: number;
  onRefresh: () => Promise<void>;
  onManageChatgptAccounts: () => void;
}

export function codexActionFor(running: boolean) {
  return running ? "restart" : "start";
}

function ProfileDragPreview({ profile, width, height, active, busy, balanceInfos, balanceError, onOpenAdmin }: { profile: ProfileSummary; width: number | null; height: number | null; active: boolean; busy: boolean; balanceInfos: ProfileBalanceInfo[]; balanceError: string; onOpenAdmin: () => void }) {
  const stateClass = active ? "is-active brand-gradient-surface is-drag-hover" : "is-drag-hover";
  return (
    <div className={`drag-dragging apple-group profile-drag-preview group flex cursor-pointer select-none flex-col gap-4 px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between ${stateClass}`} style={{ width: width ? `${width}px` : undefined, height: height ? `${height}px` : undefined }}>
      <span className="drag-handle -ml-5 -mr-4 grid shrink-0 cursor-grabbing place-items-center self-center rounded-md py-1 pl-3 pr-3 muted sm:self-stretch" aria-hidden="true">
        <GripVertical className="h-4 w-4" strokeWidth={2} />
      </span>
      <ProfileCardContent
        profile={profile}
        balanceInfos={balanceInfos}
        balanceError={balanceError}
        balanceRefreshing={false}
        onOpenAdmin={onOpenAdmin}
      />
      <ProfileCardActions active={active} busy={busy} profile={profile} testing={false} dragging />
    </div>
  );
}

export default function ProfilesView({ state, authStatusReady, activationEpoch, onRefresh, onManageChatgptAccounts }: ProfilesViewProps) {
  const feedback = useFeedback();
  const { t } = useTranslation("profiles");
  const [items, setItems] = useState(state.profiles);
  const [busy, setBusy] = useState(false);
  const [codexAction, setCodexAction] = useState<"restart" | "start" | null>(null);
  const [editingProfile, setEditingProfile] = useState<ProfileSummary | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [modal, setModal] = useState<"capture" | "rename" | null>(null);
  const [modalProfile, setModalProfile] = useState<ProfileSummary | null>(null);
  const [profileName, setProfileName] = useState("");
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null);
  const [dragHoverProfileId, setDragHoverProfileId] = useState<string | null>(null);
  const [draggedProfileWidth, setDraggedProfileWidth] = useState<number | null>(null);
  const [draggedProfileHeight, setDraggedProfileHeight] = useState<number | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const dragHoverReleaseRef = useRef<(() => void) | null>(null);
  const duplicatingProfileRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  useEffect(() => setItems(state.profiles), [state.profiles]);

  useEffect(() => () => {
    document.body.classList.remove("drag-active");
    dragHoverReleaseRef.current?.();
  }, []);

  const releaseCardHoverSuppression = () => {
    const release = dragHoverReleaseRef.current;
    if (release) release();
  };

  const suppressCardHover = () => {
    releaseCardHoverSuppression();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.classList.contains("drag-handle")) activeElement.blur();
    const release = () => {
      setDragHoverProfileId(null);
      window.removeEventListener("pointermove", release);
      if (dragHoverReleaseRef.current === release) dragHoverReleaseRef.current = null;
    };
    dragHoverReleaseRef.current = release;
    window.addEventListener("pointermove", release, { once: true });
  };

  const persistOrder = async (previous: ProfileSummary[], next: ProfileSummary[]) => {
    try {
      await api.reorderProfiles(next.map((item) => item.id));
      await onRefresh();
    } catch (error) {
      setItems(previous);
      feedback.error(String(error));
      await onRefresh();
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    document.body.classList.remove("drag-active");
    suppressCardHover();
    setDraggedProfileId(null);
    setDraggedProfileWidth(null);
    setDraggedProfileHeight(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldItems = items;
    const oldIndex = oldItems.findIndex((item) => item.id === active.id);
    const newIndex = oldItems.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(oldItems, oldIndex, newIndex);
    setItems(next);
    void persistOrder(oldItems, next);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    releaseCardHoverSuppression();
    document.body.classList.add("drag-active");
    const source = [...document.querySelectorAll<HTMLElement>("[data-profile-id]")]
      .find((node) => node.dataset.profileId === String(active.id));
    const sourceRect = source?.getBoundingClientRect();
    setDraggedProfileId(String(active.id));
    setDragHoverProfileId(String(active.id));
    setDraggedProfileWidth(active.rect.current.initial?.width ?? sourceRect?.width ?? null);
    setDraggedProfileHeight(active.rect.current.initial?.height ?? sourceRect?.height ?? null);
  };

  const onDragCancel = () => {
    document.body.classList.remove("drag-active");
    suppressCardHover();
    setDraggedProfileId(null);
    setDraggedProfileWidth(null);
    setDraggedProfileHeight(null);
  };

  const openCapture = () => { setModal("capture"); setModalProfile(null); setProfileName(""); };
  const openRename = (profile: ProfileSummary) => { setModal("rename"); setModalProfile(profile); setProfileName(profile.name); };

  const submitModal = async () => {
    if (busy || !modal) return;
    setBusy(true);
    try {
      if (modal === "capture") {
        await api.captureProfile(profileName.trim());
        feedback.success(t("feedback.captureSuccess"));
      } else if (modalProfile) {
        await api.renameProfile(modalProfile.id, profileName.trim());
        feedback.success(t("feedback.providerRenamed"));
      }
      setModal(null);
      await onRefresh();
    } catch (error) { feedback.error(String(error)); }
    finally { setBusy(false); }
  };

  const restart = async (force = false, notifySuccess = true) => {
    if (busy && !force) return false;
    setBusy(true);
    setCodexAction(codexActionFor(state.codex.running));
    try {
      await api.restartCodex();
      if (notifySuccess) feedback.success(t("feedback.codexRestarted"));
      await onRefresh();
      return true;
    } catch (error) {
      feedback.error(String(error));
      return false;
    } finally {
      setCodexAction(null);
      setBusy(false);
    }
  };

  const applyProfile = async (profile: ProfileSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.applyProfile(profile.id);
      await onRefresh();
      if (state.settings.auto_restart) {
        if (await restart(true, false)) feedback.success(t("feedback.switchRestarted"));
      } else {
        feedback.success(t("feedback.switchSuccess"));
      }
    } catch (error) {
      const message = String(error);
      // 凭证失效类错误出本地化的可行动文案，其余保持后端原文
      feedback.error(authQuotaErrorKind(message) === "auth_expired" ? t("balance.authInvalidToast") : message);
    }
    finally { setBusy(false); }
  };

  const removeProfile = async (profile: ProfileSummary) => {
    const confirmed = await feedback.confirm({ title: t("confirm.deleteTitle"), description: <Trans ns="profiles" i18nKey="confirm.deleteConfirm" values={{ name: profile.name }} components={{ strong: <strong /> }} />, confirmText: t("confirm.delete"), destructive: true });
    if (!confirmed) return;
    const previousIndex = items.findIndex((item) => item.id === profile.id);
    setItems((current) => current.filter((item) => item.id !== profile.id));
    try {
      await api.deleteProfile(profile.id);
      feedback.success(t("feedback.providerDeleted"));
      await onRefresh();
    } catch (error) {
      setItems((current) => {
        if (current.some((item) => item.id === profile.id)) return current;
        const index = Math.max(0, Math.min(previousIndex, current.length));
        return [...current.slice(0, index), profile, ...current.slice(index)];
      });
      feedback.error(String(error));
    }
  };

  const duplicateProfile = async (profile: ProfileSummary) => {
    if (busy || duplicatingProfileRef.current) return;
    duplicatingProfileRef.current = true;
    try { await api.duplicateProfile(profile.id); feedback.success(t("feedback.providerDuplicated")); await onRefresh(); }
    catch (error) { feedback.error(String(error)); }
    finally { duplicatingProfileRef.current = false; }
  };

  const closeEdit = async () => { setEditingProfile(null); setCreatingProfile(false); await onRefresh(); };
  const draggedProfile = draggedProfileId ? items.find((profile) => profile.id === draggedProfileId) ?? null : null;
  const draggedQuotaKey = draggedProfile ? profileAuthQuotaCacheKey(draggedProfile) : null;

  if (editingProfile || creatingProfile) {
    return <ProfileEdit profile={editingProfile} create={creatingProfile} authStatus={state.auth_status} authStatusReady={authStatusReady} onBack={() => void closeEdit()} onChanged={() => void onRefresh()} onManageChatgptAccounts={onManageChatgptAccounts} />;
  }

  const nextCodexAction = codexActionFor(state.codex.running);

  return (
    <section className="apple-scroll-page mx-auto w-full max-w-none">
      <header className="apple-page-bar flex-wrap justify-between gap-4">
        <div className="min-w-0"><UpdateNotice /></div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 text-sm">
          <div className={`codex-status-control codex-status--${state.codex.running ? "running" : "stopped"} text-xs font-medium`}>
            <span className="codex-status" role="status" aria-live="polite" aria-atomic="true">
              <span className="codex-status__signal" aria-hidden="true"><span className="codex-status__signal-dot" /></span>
              <span className="codex-status__name">Codex</span>
              <span className="codex-status__label">{state.codex.running ? t("status.running") : t("status.stopped")}</span>
            </span>
            <button type="button" className="codex-status__action" disabled={busy} title={t(`toolbar.${nextCodexAction}`)} aria-label={codexAction ? t(`toolbar.${codexAction}ing`) : t(`toolbar.${nextCodexAction}`)} onClick={() => void restart(false)}>
              {(codexAction ?? nextCodexAction) === "restart" ? <RefreshCw className={`h-4 w-4 ${codexAction ? "animate-spin" : ""}`} strokeWidth={2} /> : <Play className={`h-4 w-4 ${codexAction ? "animate-spin" : ""}`} strokeWidth={2} />}
            </button>
          </div>
          <button type="button" className="apple-action-button app-button--primary disabled:!opacity-100" disabled={busy}
            onClick={() => setCreatingProfile(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />{t("toolbar.addProvider")}
          </button>
        </div>
      </header>
      <div className="apple-edit-content profiles-page-content">
            <div className="profiles-page-content__body">{items.length === 0 ? <EmptyStateCard icon={<Layers2 className="h-5 w-5" strokeWidth={2} />}><p className="muted">{t("empty.description")}</p><button type="button" className="apple-action-button app-button--primary" disabled={busy} onClick={openCapture}><Camera className="h-4 w-4" strokeWidth={2} />{t("toolbar.capture")}</button></EmptyStateCard> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}><SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="profile-list relative space-y-[var(--gap-page)]">{items.map((profile) => <ProfileCard key={profile.id} profile={profile} active={profile.id === state.active_profile_id} dragHover={profile.id === dragHoverProfileId} busy={busy} activationEpoch={activationEpoch} balanceCache={state.balance_cache} onApply={() => void applyProfile(profile)} onRename={() => openRename(profile)} onEdit={() => setEditingProfile(profile)} onRemove={() => void removeProfile(profile)} onDuplicate={() => void duplicateProfile(profile)} />)}</div></SortableContext>{createPortal(<DragOverlay dropAnimation={null}>{draggedProfile ? <ProfileDragPreview profile={draggedProfile} width={draggedProfileWidth} height={draggedProfileHeight} active={draggedProfile.id === state.active_profile_id} busy={busy} balanceInfos={[getCachedProfileBalance(draggedProfile.id, state.balance_cache?.[draggedProfile.id] ?? null, draggedQuotaKey)].filter((info): info is ProfileBalanceInfo => info != null)} balanceError={getCachedProfileBalanceError(draggedProfile.id, draggedQuotaKey)} onOpenAdmin={() => void api.openUrl(draggedProfile.admin_url!).catch((error) => feedback.error(String(error)))} /> : null}</DragOverlay>, document.body)}</DndContext>}</div>
      </div>
      <AppDialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }} title={modal === "capture" ? t("dialog.captureTitle") : t("dialog.renameTitle")} initialFocusRef={nameInput} footer={<><button type="button" className="apple-action-button" onClick={() => setModal(null)}>{t("dialog.cancel")}</button><button type="button" className="apple-action-button app-button--primary" disabled={busy || !profileName.trim()} onClick={() => void submitModal()}>{t("dialog.save")}</button></>}>
        <div className="space-y-4"><p className="muted text-sm">{modal === "capture" ? t("dialog.captureDescription") : t("dialog.renameDescription")}</p><input ref={nameInput} className="app-input" maxLength={50} placeholder={t("dialog.namePlaceholder")} value={profileName} onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submitModal(); }} /></div>
      </AppDialog>
    </section>
  );
}

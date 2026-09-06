import { Camera, GripVertical, Plus, RefreshCw, Server } from "lucide-react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppDialog } from "../../components/AppDialog";
import { EmptyStateCard } from "../../components/EmptyStateCard";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import type { AppState, AuthStatus, ProfileBalanceInfo, ProfileSummary } from "../../types";
import ProfileCard, { getCachedProfileBalance, getCachedProfileBalanceError, ProfileCardActions, ProfileCardContent } from "./ProfileCard";
import ProfileEdit from "./ProfileEdit";

interface ProfilesViewProps {
  state: AppState;
  activationEpoch: number;
  onRefresh: () => Promise<void>;
  onManageChatgptAccounts: () => void;
}

function ProfileDragPreview({ profile, width, height, active, busy, subscriptionAuthed, balanceInfos, balanceError, onOpenAdmin }: { profile: ProfileSummary; width: number | null; height: number | null; active: boolean; busy: boolean; subscriptionAuthed: boolean; balanceInfos: ProfileBalanceInfo[]; balanceError: string; onOpenAdmin: () => void }) {
  const stateClass = active ? "is-active is-drag-hover" : "is-drag-hover";
  const connectionDimmed = !profile.provider ? !subscriptionAuthed : !profile.has_key;
  const connectionTitle = !profile.provider ? subscriptionAuthed ? "测试订阅认证连通性" : "尚未认证 ChatGPT 订阅" : !profile.has_key ? "缺少 API 密钥，点击查看提示" : "测试连通性";
  return (
    <div className={`drag-dragging apple-group profile-drag-preview group flex cursor-pointer select-none flex-col gap-4 px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between ${stateClass}`} style={{ width: width ? `${width}px` : undefined, height: height ? `${height}px` : undefined }}>
      <span className="drag-handle -ml-5 -mr-4 grid shrink-0 cursor-grabbing place-items-center self-center rounded-md py-1 pl-3 pr-3 muted sm:self-stretch" aria-hidden="true">
        <GripVertical className="h-4 w-4" strokeWidth={2} />
      </span>
      <ProfileCardContent
        profile={profile}
        subscriptionAuthed={subscriptionAuthed}
        balanceInfos={balanceInfos}
        balanceError={balanceError}
        onOpenAdmin={onOpenAdmin}
      />
      <ProfileCardActions active={active} busy={busy} connectionDimmed={connectionDimmed} connectionTitle={connectionTitle} testing={false} dragging />
    </div>
  );
}

export default function ProfilesView({ state, activationEpoch, onRefresh, onManageChatgptAccounts }: ProfilesViewProps) {
  const feedback = useFeedback();
  const [items, setItems] = useState(state.profiles);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProfileSummary | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [modal, setModal] = useState<"capture" | "rename" | null>(null);
  const [modalProfile, setModalProfile] = useState<ProfileSummary | null>(null);
  const [profileName, setProfileName] = useState("");
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null);
  const [dragHoverProfileId, setDragHoverProfileId] = useState<string | null>(null);
  const [draggedProfileWidth, setDraggedProfileWidth] = useState<number | null>(null);
  const [draggedProfileHeight, setDraggedProfileHeight] = useState<number | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(state.auth_status);
  const nameInput = useRef<HTMLInputElement>(null);
  const dragHoverReleaseRef = useRef<(() => void) | null>(null);
  const duplicatingProfileRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  useEffect(() => setItems(state.profiles), [state.profiles]);
  useEffect(() => setAuthStatus(state.auth_status), [state.auth_status]);

  useEffect(() => () => {
    document.body.classList.remove("drag-active");
    dragHoverReleaseRef.current?.();
  }, []);

  useEffect(() => {
    void api.authGetStatus().then(setAuthStatus).catch(() => undefined);
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
        feedback.success("捕获成功");
      } else if (modalProfile) {
        await api.renameProfile(modalProfile.id, profileName.trim());
        feedback.success("供应商已重命名");
      }
      setModal(null);
      await onRefresh();
    } catch (error) { feedback.error(String(error)); }
    finally { setBusy(false); }
  };

  const restart = async (force = false) => {
    if (busy && !force) return;
    setBusy(true);
    setRestarting(true);
    try {
      await api.restartCodex();
      feedback.success("Codex 已重启");
      await onRefresh();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setRestarting(false);
      setBusy(false);
    }
  };

  const applyProfile = async (profile: ProfileSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.applyProfile(profile.id);
      feedback.success("切换成功，重启Codex生效");
      if (state.settings.auto_restart) await restart(true);
      await onRefresh();
    } catch (error) { feedback.error(String(error)); }
    finally { setBusy(false); }
  };

  const removeProfile = async (profile: ProfileSummary) => {
    const confirmed = await feedback.confirm({ title: "删除供应商", description: <>确定删除“<strong>{profile.name}</strong>”吗？删除后不可恢复。</>, confirmText: "删除", destructive: true });
    if (!confirmed) return;
    const previousIndex = items.findIndex((item) => item.id === profile.id);
    setItems((current) => current.filter((item) => item.id !== profile.id));
    try {
      await api.deleteProfile(profile.id);
      feedback.success("供应商已删除");
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
    try { await api.duplicateProfile(profile.id); feedback.success("供应商已复制"); await onRefresh(); }
    catch (error) { feedback.error(String(error)); }
    finally { duplicatingProfileRef.current = false; }
  };

  const closeEdit = async () => { setEditingProfile(null); setCreatingProfile(false); await onRefresh(); };
  const profileAuthAvailable = (profile: ProfileSummary) => profile.auth_source === "oauth"
    ? Boolean(profile.account_id && authStatus.accounts.some((account) => account.id === profile.account_id))
    : profile.auth_source === "desktop"
      ? Boolean(authStatus.external)
      : profile.account_id
        ? authStatus.accounts.some((account) => account.id === profile.account_id)
        : Boolean(authStatus.external);
  const draggedProfile = draggedProfileId ? items.find((profile) => profile.id === draggedProfileId) ?? null : null;

  if (editingProfile || creatingProfile) {
    return <ProfileEdit profile={editingProfile} create={creatingProfile} onBack={() => void closeEdit()} onChanged={() => void onRefresh()} onManageChatgptAccounts={onManageChatgptAccounts} />;
  }

  return (
    <section className="apple-scroll-page mx-auto w-full max-w-none">
      <header className="apple-page-bar flex-wrap justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span
            className={`codex-status codex-status--${state.codex.running ? "running" : "stopped"} text-xs font-medium`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="codex-status__signal" aria-hidden="true"><span className="codex-status__signal-dot" /></span>
            <span className="codex-status__name">Codex</span>
            <span className="codex-status__divider" aria-hidden="true" />
            <span className="codex-status__label">{state.codex.running ? "运行中" : "未运行"}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="apple-toolbar-group">
            <button type="button" className="apple-action-button apple-action-button--quaternary"
              disabled={busy}
              title="重启 Codex" onClick={() => void restart(false)}>
              {restarting ? <LoadingSpinner size="md" /> : <RefreshCw className="h-4 w-4" strokeWidth={2} />}
              {restarting ? "重启中…" : "重启 Codex"}
            </button>
            <button type="button" className="apple-icon-button text-accent" disabled={busy}
              title="捕获当前配置" aria-label="捕获当前配置" onClick={openCapture}>
              <Camera className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <button type="button" className="apple-action-button app-button--primary" disabled={busy}
            onClick={() => setCreatingProfile(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />添加供应商
          </button>
        </div>
      </header>
      <div className="apple-edit-content">
        <div>{items.length === 0 ? <EmptyStateCard icon={<Server className="h-5 w-5" strokeWidth={1.8} />}><p className="muted">还没有供应商配置。可以添加内置官方供应商，或先把 ~/.codex/config.toml 调整到目标状态，再点击“捕获当前配置”。</p></EmptyStateCard> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}><SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="profile-list relative space-y-[var(--gap-page)] will-change-transform">{items.map((profile) => <ProfileCard key={profile.id} profile={profile} active={profile.id === state.active_profile_id} dragHover={profile.id === dragHoverProfileId} busy={busy} activationEpoch={activationEpoch} subscriptionAuthed={profileAuthAvailable(profile)} balanceCache={state.balance_cache} onApply={() => void applyProfile(profile)} onRename={() => openRename(profile)} onEdit={() => setEditingProfile(profile)} onRemove={() => void removeProfile(profile)} onDuplicate={() => void duplicateProfile(profile)} />)}</div></SortableContext>{createPortal(<DragOverlay dropAnimation={null}>{draggedProfile ? <ProfileDragPreview profile={draggedProfile} width={draggedProfileWidth} height={draggedProfileHeight} active={draggedProfile.id === state.active_profile_id} busy={busy} subscriptionAuthed={profileAuthAvailable(draggedProfile)} balanceInfos={[getCachedProfileBalance(draggedProfile.id, state.balance_cache?.[draggedProfile.id] ?? null)].filter((info): info is ProfileBalanceInfo => info != null)} balanceError={getCachedProfileBalanceError(draggedProfile.id)} onOpenAdmin={() => void api.openUrl(draggedProfile.admin_url!).catch((error) => feedback.error(String(error)))} /> : null}</DragOverlay>, document.body)}</DndContext>}</div>
      </div>
      <AppDialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }} title={modal === "capture" ? "保存当前配置快照" : "重命名供应商"} initialFocusRef={nameInput} footer={<><button type="button" className="apple-action-button" onClick={() => setModal(null)}>取消</button><button type="button" className="apple-action-button app-button--primary" disabled={busy || !profileName.trim()} onClick={() => void submitModal()}>保存</button></>}>
        <div className="space-y-4"><p className="muted text-sm">{modal === "capture" ? "为当前 Codex 配置创建快照，切换供应商后可一键恢复。" : "输入新的供应商名称。"}</p><input ref={nameInput} className="app-input" maxLength={50} placeholder="例如：DeepSeek 日常" value={profileName} onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submitModal(); }} /></div>
      </AppDialog>
    </section>
  );
}

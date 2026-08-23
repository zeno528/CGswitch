import { Camera, Plus, RefreshCw } from "lucide-react";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppDialog } from "../../components/AppDialog";
import { ProfileIconTile } from "../../components/ProfileIconTile";
import type { AppState, AuthStatus, ProfileSummary, RestartStage } from "../../types";
import ProfileCard from "./ProfileCard";
import ProfileEdit from "./ProfileEdit";

interface ProfilesViewProps {
  state: AppState;
  activationEpoch: number;
  onRefresh: () => Promise<void>;
}

const progressByStage: Record<RestartStage, number> = { idle: 0, stopping: 18, waiting: 48, launching: 82, success: 100, error: 100 };
const textByStage: Record<RestartStage, string> = { idle: "空闲", stopping: "正在停止 Codex", waiting: "等待进程退出", launching: "正在启动 Codex", success: "重启成功", error: "重启失败" };
const RESTART_CARD_DURATION = 360;

interface RestartProgressCardProps {
  stage: RestartStage;
  message: string;
  visible: boolean;
  onHidden: () => void;
}

function ProfileDragPreview({ profile, width }: { profile: ProfileSummary; width: number | null }) {
  return <div className="drag-dragging profile-drag-preview" style={{ width: width ? `${width}px` : undefined }}><div className="flex items-center gap-3 px-5 py-4.5"><ProfileIconTile name={profile.name} icon={profile.icon} /><div className="min-w-0"><div className="title-md truncate">{profile.name}</div><div className="muted mt-1 flex items-center gap-1"><span className="apple-chip">{profile.model ?? "未设置"}</span>{profile.provider ? <span className="apple-chip">{profile.provider}</span> : null}<span className="apple-chip">{profile.reasoning_effort ?? "默认"}</span></div></div></div></div>;
}

function RestartProgressCard({ stage, message, visible, onHidden }: RestartProgressCardProps) {
  const revealRef = useRef<HTMLDivElement>(null);

  // 出场：grid 收起过渡结束后卸载；transitionend 丢失时用定时器兜底
  useEffect(() => {
    if (visible) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onHidden();
      return;
    }
    const node = revealRef.current;
    if (!node) {
      onHidden();
      return;
    }
    const finish = (event?: TransitionEvent) => {
      if (event && (event.target !== node || event.propertyName !== "grid-template-rows")) return;
      onHidden();
    };
    node.addEventListener("transitionend", finish as EventListener);
    const timer = window.setTimeout(() => finish(), RESTART_CARD_DURATION + 80);
    return () => {
      node.removeEventListener("transitionend", finish as EventListener);
      window.clearTimeout(timer);
    };
  }, [visible, onHidden]);

  return <div ref={revealRef} className={`restart-card-reveal${visible ? " restart-card-reveal--open" : ""}`} aria-hidden={!visible}><div className="restart-card-reveal__inner"><div className="apple-group mb-[var(--gap-page)] px-4 py-3"><div className="flex items-center justify-between gap-3"><div className="font-semibold">重启进度</div><span className={`apple-chip ${stage === "error" ? "chip-danger" : stage === "success" ? "chip-success" : ""}`}>{textByStage[stage]}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-black/8 dark:bg-white/8"><div className={`h-full rounded-full transition-[width] duration-300 ${stage === "error" ? "bg-danger" : stage === "success" ? "bg-success" : "bg-accent"}`} style={{ width: `${progressByStage[stage]}%` }} /></div>{message ? <p className="muted mt-3 text-sm">{message}</p> : null}</div></div></div>;
}

export default function ProfilesView({ state, activationEpoch, onRefresh }: ProfilesViewProps) {
  const feedback = useFeedback();
  const [items, setItems] = useState(state.profiles);
  const [busy, setBusy] = useState(false);
  const [restartStage, setRestartStage] = useState<RestartStage>("idle");
  const [restartMessage, setRestartMessage] = useState("");
  const [restartCardStage, setRestartCardStage] = useState<RestartStage>("idle");
  const [restartCardMounted, setRestartCardMounted] = useState(false);
  const [restartCardVisible, setRestartCardVisible] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ProfileSummary | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [modal, setModal] = useState<"capture" | "rename" | null>(null);
  const [modalProfile, setModalProfile] = useState<ProfileSummary | null>(null);
  const [profileName, setProfileName] = useState("");
  const [draggedProfileId, setDraggedProfileId] = useState<string | null>(null);
  const [draggedProfileWidth, setDraggedProfileWidth] = useState<number | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(state.auth_status);
  const nameInput = useRef<HTMLInputElement>(null);
  const previousRestartStage = useRef<RestartStage>("idle");
  const dragHoverReleaseRef = useRef<(() => void) | null>(null);
  const duplicatingProfileRef = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  useEffect(() => setItems(state.profiles), [state.profiles]);
  useEffect(() => setAuthStatus(state.auth_status), [state.auth_status]);

  useEffect(() => () => {
    document.body.classList.remove("drag-active", "drag-settling");
    dragHoverReleaseRef.current?.();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void api.onRestartProgress((payload) => {
      if (!disposed) {
        setRestartStage(payload.stage);
        setRestartMessage(payload.message ?? "");
      }
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });
    void api.authGetStatus().then((status) => { if (!disposed) setAuthStatus(status); }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (restartStage !== "success") return;
    const timer = window.setTimeout(() => setRestartStage("idle"), 1200);
    return () => window.clearTimeout(timer);
  }, [restartStage]);

  useEffect(() => {
    if (restartStage === "idle") {
      if (previousRestartStage.current !== "idle") setRestartCardVisible(false);
    } else {
      setRestartCardStage(restartStage);
      setRestartCardMounted(true);
      setRestartCardVisible(true);
    }
    previousRestartStage.current = restartStage;
  }, [restartStage]);

  const onRestartCardHidden = useCallback(() => setRestartCardMounted(false), []);

  const releaseCardHoverSuppression = () => {
    const release = dragHoverReleaseRef.current;
    if (release) release();
  };

  const suppressCardHover = () => {
    releaseCardHoverSuppression();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.classList.contains("drag-handle")) activeElement.blur();
    document.body.classList.add("drag-settling");
    const release = () => {
      document.body.classList.remove("drag-settling");
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
    setDraggedProfileId(String(active.id));
    setDraggedProfileWidth(active.rect.current.initial?.width ?? null);
  };

  const onDragCancel = () => {
    document.body.classList.remove("drag-active");
    suppressCardHover();
    setDraggedProfileId(null);
    setDraggedProfileWidth(null);
  };

  const openCapture = () => { setModal("capture"); setModalProfile(null); setProfileName(""); };
  const openRename = (profile: ProfileSummary) => { setModal("rename"); setModalProfile(profile); setProfileName(profile.name); };

  const submitModal = async () => {
    if (busy || !modal) return;
    setBusy(true);
    try {
      if (modal === "capture") {
        await api.captureProfile(profileName.trim());
        feedback.success("已捕获并设为使用中");
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
    setRestartStage("stopping");
    setRestartMessage("");
    try {
      await api.restartCodex();
      feedback.success("Codex 已重启");
      await onRefresh();
    } catch (error) {
      setRestartStage("error");
      setRestartMessage(String(error));
      feedback.error(String(error));
    } finally { setBusy(false); }
  };

  const applyProfile = async (profile: ProfileSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.applyProfile(profile.id);
      feedback.success("模型配置已应用");
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
    try { const copy = await api.duplicateProfile(profile.id); feedback.success(`已复制为「${copy.name}」`); await onRefresh(); }
    catch (error) { feedback.error(String(error)); }
    finally { duplicatingProfileRef.current = false; }
  };

  const closeEdit = async () => { setEditingProfile(null); setCreatingProfile(false); await onRefresh(); };
  const boundAccountLogin = (profile: ProfileSummary) => authStatus.accounts.find((account) => account.id === profile.account_id)?.login ?? null;
  const subscriptionAccount = authStatus.external?.login ?? authStatus.accounts[0]?.login ?? null;
  const subscriptionSource = authStatus.external ? "desktop" : authStatus.accounts.length ? "oauth" : null;
  const draggedProfile = draggedProfileId ? items.find((profile) => profile.id === draggedProfileId) ?? null : null;

  if (editingProfile || creatingProfile) {
    return <ProfileEdit profile={editingProfile} create={creatingProfile} onBack={() => void closeEdit()} onChanged={() => void onRefresh()} />;
  }

  return (
    <section className="apple-scroll-page mx-auto w-full max-w-none">
      <header className="apple-page-bar flex-wrap justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${state.codex.running ? "border-success/25 bg-success/10 text-[var(--success-text)] dark:border-success/30 dark:bg-success/10" : "border-[var(--panel-border)] bg-black/4 muted dark:bg-white/6"}`}><span className="relative flex h-2 w-2"><span className={`relative inline-flex h-2 w-2 rounded-full ${state.codex.running ? "bg-success shadow-[0_0_6px_1px_rgba(52,199,89,0.45)]" : "bg-black/40 dark:bg-white/40"}`} /></span>Codex {state.codex.running ? "运行中" : "未运行"}</span></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="apple-toolbar-group">
            <button type="button" className="apple-action-button apple-action-button--quaternary"
              disabled={busy || (restartStage !== "idle" && restartStage !== "success" && restartStage !== "error")}
              title="重启 Codex" onClick={() => void restart(false)}>
              <RefreshCw className="h-4 w-4" strokeWidth={2} />重启 Codex
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
        {restartCardMounted ? <RestartProgressCard stage={restartCardStage} message={restartMessage} visible={restartCardVisible} onHidden={onRestartCardHidden} /> : null}
        <div>{items.length === 0 ? <div className="apple-group py-14 text-center"><p className="muted">还没有供应商配置。可以添加内置官方供应商，或先把 ~/.codex/config.toml 调整到目标状态，再点击“捕获当前配置”。</p></div> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}><SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}><div className="profile-list apple-group relative will-change-transform">{items.map((profile) => <ProfileCard key={profile.id} profile={profile} active={profile.id === state.active_profile_id} busy={busy} activationEpoch={activationEpoch} subscriptionAuthed={authStatus.authenticated} subscriptionAccount={subscriptionAccount} subscriptionSource={subscriptionSource} boundAccount={boundAccountLogin(profile)} balanceCache={state.balance_cache} onApply={() => void applyProfile(profile)} onRename={() => openRename(profile)} onEdit={() => setEditingProfile(profile)} onRemove={() => void removeProfile(profile)} onDuplicate={() => void duplicateProfile(profile)} />)}</div></SortableContext><DragOverlay dropAnimation={null}>{draggedProfile ? <ProfileDragPreview profile={draggedProfile} width={draggedProfileWidth} /> : null}</DragOverlay></DndContext>}</div>
      </div>
      <AppDialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }} title={modal === "capture" ? "保存当前配置快照" : "重命名供应商"} initialFocusRef={nameInput} footer={<><button type="button" className="apple-action-button" onClick={() => setModal(null)}>取消</button><button type="button" className="apple-action-button app-button--primary" disabled={busy || !profileName.trim()} onClick={() => void submitModal()}>保存</button></>}>
        <div className="space-y-4"><p className="muted text-sm">{modal === "capture" ? "为当前 Codex 配置创建快照，切换供应商后可一键恢复。" : "输入新的供应商名称。"}</p><input ref={nameInput} className="app-input" maxLength={50} placeholder="例如：DeepSeek 日常" value={profileName} onChange={(event) => setProfileName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submitModal(); }} /></div>
      </AppDialog>
    </section>
  );
}

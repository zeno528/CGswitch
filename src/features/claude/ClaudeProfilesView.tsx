import { Camera, GripVertical, Layers2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppDialog } from "../../components/AppDialog";
import { EmptyStateCard } from "../../components/EmptyStateCard";
import SortableCard from "../../components/SortableCard";
import { useCardDragReorder } from "../../components/useCardDragReorder";
import { ProfileCardActions, ProfileCardContent, getCachedProfileBalance, getCachedProfileBalanceError } from "../profiles/ProfileCard";
import { useProfileBalance } from "../profiles/useProfileBalance";
import { claudeBalanceQueryKinds } from "../../presets";
import ClaudeProfileEdit from "./ClaudeProfileEdit";
import type { ClaudeProfileDetail, ClaudeProfileSummary, ProfileBalanceInfo } from "../../types";

function cardProfile(profile: ClaudeProfileSummary) {
  return {
    name: profile.name,
    icon: profile.icon,
    kind: "third_party" as const,
    provider: profile.kind ?? null,
    model: profile.model,
    reasoning_effort: null,
    plan_type: null,
    admin_url: profile.admin_url,
    show_balance: profile.show_balance,
  };
}

/** 拖拽浮层预览：按源卡片几何渲染同款卡片（非交互）。 */
function ClaudeDragPreview({ profile, width, height, active, busy, balanceCache }: { profile: ClaudeProfileSummary; width: number | null; height: number | null; active: boolean; busy: boolean; balanceCache: Record<string, ProfileBalanceInfo> }) {
  const feedback = useFeedback();
  const { t: tProfiles } = useTranslation("profiles");
  const hasCredential = Boolean(profile.base_url) && profile.has_token;
  const balance = getCachedProfileBalance(profile.id, balanceCache[profile.id] ?? null);
  const balanceError = getCachedProfileBalanceError(profile.id);
  return (
    <div
      className={`drag-dragging apple-group profile-drag-preview group flex cursor-pointer select-none flex-col gap-4 px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between ${active ? "is-active brand-gradient-surface is-drag-hover" : "is-drag-hover"}`}
      style={{ width: width ? `${width}px` : undefined, height: height ? `${height}px` : undefined }}
    >
      <span className="drag-handle -ml-5 -mr-4 grid shrink-0 cursor-grabbing place-items-center self-center rounded-md py-1 pl-3 pr-3 muted sm:self-stretch" aria-hidden="true">
        <GripVertical className="h-4 w-4" strokeWidth={2} />
      </span>
      <ProfileCardContent profile={cardProfile(profile)} hideModel balanceInfos={balance ? [balance] : []} balanceError={balanceError} balanceRefreshing={false} onOpenAdmin={() => void api.openUrl(profile.admin_url!).catch((error) => feedback.error(String(error)))} />
      <ProfileCardActions active={active} busy={busy} testing={false} dragging connectionDisabled={!hasCredential} connectionTitle={tProfiles("connection.test")} />
    </div>
  );
}

function ClaudeProfileCard({ profile, active, dragHover, busy, testing, activationEpoch, coldStart, balanceCache, onEdit, onApply, onDuplicate, onTest, onRemove }: {
  profile: ClaudeProfileSummary;
  active: boolean;
  dragHover: boolean;
  busy: boolean;
  testing: boolean;
  activationEpoch: number;
  coldStart: boolean;
  balanceCache: Record<string, ProfileBalanceInfo>;
  onEdit: () => void;
  onApply: () => void;
  onDuplicate: () => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  const feedback = useFeedback();
  const { t } = useTranslation("profiles");
  const { t: tClaude } = useTranslation("claude");
  const supportsBalance = claudeBalanceQueryKinds.has(profile.kind ?? "");
  const balance = useProfileBalance({
    profileId: profile.id,
    showBalance: profile.show_balance,
    supportsBalance,
    hasCredential: Boolean(profile.has_token),
    active,
    activationEpoch,
    coldStart,
    cachedBalance: balanceCache[profile.id],
    source: "claude",
  });
  const connection = profileConnectionGate(profile, tClaude);
  return (
    <SortableCard id={profile.id} active={active} dragHover={dragHover} onClick={onEdit} title={t("card.clickToEdit")} handleTitle={t("card.dragToReorder")}>
      <ProfileCardContent profile={cardProfile(profile)} hideModel balanceInfos={balance.balanceInfos} balanceError={balance.balanceError} balanceRefreshing={balance.balanceRefreshing} onRefreshBalance={balance.refreshBalance} onOpenAdmin={() => void api.openUrl(profile.admin_url!).catch((error) => feedback.error(String(error)))} onRename={onEdit} />
      <ProfileCardActions active={active} busy={busy} testing={testing} connectionDisabled={connection.disabled} connectionTitle={connection.title} onApply={onApply} onDuplicate={onDuplicate} onTest={onTest} onRemove={onRemove} />
    </SortableCard>
  );
}

// 页面数据只在进页时加载（AppShell 按 view==="claude" 挂载本组件），不入启动关键路径。
export default function ClaudeProfilesView({ activeId, onChanged, activationEpoch, coldStart, balanceCache }: { activeId: string | null; onChanged: () => void; activationEpoch: number; coldStart: boolean; balanceCache: Record<string, ProfileBalanceInfo> }) {
  const feedback = useFeedback();
  const { t } = useTranslation("claude");
  // 卡片外壳/操作行的悬停文案直接用 profiles 资源（与 Codex 同词），不另造 key
  const { t: tProfiles } = useTranslation("profiles");
  const [items, setItems] = useState<ClaudeProfileSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureName, setCaptureName] = useState("");
  const captureNameInput = useRef<HTMLInputElement>(null);
  const [editingProfile, setEditingProfile] = useState<ClaudeProfileSummary | null>(null);
  const [editDetail, setEditDetail] = useState<ClaudeProfileDetail | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setItems(await api.claudeListProfiles());
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const persistOrder = async (previous: ClaudeProfileSummary[], next: ClaudeProfileSummary[]) => {
    try {
      await api.claudeReorderProfiles(next.map((item) => item.id));
    } catch (error) {
      setItems(previous);
      feedback.error(String(error));
    }
  };
  const { sensors, draggedId, dragHoverId, dragWidth, dragHeight, onDragStart, onDragEnd, onDragCancel } = useCardDragReorder(items, setItems, persistOrder);

  const openCreate = () => {
    if (!busy) setCreatingProfile(true);
  };

  const capture = async () => {
    if (busy || !captureName.trim()) return;
    setBusy(true);
    try {
      await api.claudeCaptureProfile(captureName.trim());
      feedback.success(tProfiles("feedback.captureSuccess"));
      setCaptureOpen(false);
      await refresh();
      onChanged();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = async (profile: ClaudeProfileSummary) => {
    // 先预载详情再切换：编辑页在详情未就绪时整页返回 null，直接切换会空一帧（Codex openEdit 同模式）
    let detail: ClaudeProfileDetail | null = null;
    try {
      detail = await api.claudeGetProfile(profile.id);
    } catch { /* 详情由编辑页挂载后重取 */ }
    setEditDetail(detail);
    setEditingProfile(profile);
  };

  const closeEdit = async () => {
    setEditingProfile(null);
    setEditDetail(null);
    setCreatingProfile(false);
    await refresh();
    onChanged();
  };

  if (creatingProfile || editingProfile) {
    return (
      <ClaudeProfileEdit
        profile={editingProfile}
        create={creatingProfile}
        initialDetail={editDetail}
        onBack={() => void closeEdit()}
        onChanged={() => {
          void refresh();
          onChanged();
        }}
      />
    );
  }

  const applyProfile = async (profile: ClaudeProfileSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.claudeApplyProfile(profile.id);
      feedback.success(t("appliedToast"));
      onChanged();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  const duplicateProfile = async (profile: ClaudeProfileSummary) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.claudeDuplicateProfile(profile.id);
      feedback.success(t("duplicatedToast"));
      await refresh();
      onChanged();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  const testProfile = async (profile: ClaudeProfileSummary) => {
    if (testingId) return;
    setTestingId(profile.id);
    try {
      const latency = await api.claudeTestProfile(profile.id);
      feedback.success(t("connectionOk", { latency: ` · ${latency}ms` }));
    } catch (error) {
      feedback.error(t("connectionFailed", { error: String(error) }));
    } finally {
      setTestingId(null);
    }
  };

  const deleteProfile = async (profile: ClaudeProfileSummary) => {
    if (busy) return;
    const confirmed = await feedback.confirm({
      title: t("deleteDialogTitle"),
      description: t("deleteDialogDescription", { name: profile.name }),
      confirmText: t("delete"),
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.claudeDeleteProfile(profile.id);
      feedback.success(t("deletedToast"));
      await refresh();
      onChanged();
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setBusy(false);
    }
  };

  const draggedProfile = draggedId ? items.find((profile) => profile.id === draggedId) ?? null : null;

  return (
    <section className="apple-scroll-page mx-auto w-full max-w-none">
      <header className="apple-page-bar flex-wrap justify-between gap-4">
        <div className="provider-page-brand">
          <img src="/claude-code.svg" alt="" className="provider-page-brand__logo" draggable="false" />
          <span>Claude Code</span>
        </div>
        <button type="button" className="apple-action-button app-button--primary" disabled={busy} onClick={openCreate}>
          <Plus className="h-4 w-4" />
          {tProfiles("toolbar.addProvider")}
        </button>
      </header>
      <div className="apple-edit-content">
        {!loaded ? null : items.length === 0 ? (
          <EmptyStateCard icon={<Layers2 className="h-5 w-5" strokeWidth={2} />}>
            <p className="muted">{t("empty")}</p>
            <button type="button" className="apple-action-button app-button--primary" disabled={busy} onClick={() => { setCaptureName(""); setCaptureOpen(true); }}>
              <Camera className="h-4 w-4" strokeWidth={2} />
              {tProfiles("toolbar.capture")}
            </button>
          </EmptyStateCard>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <div className="profile-list relative space-y-[var(--gap-page)]">
                {items.map((profile) => {
                  return (
                    <ClaudeProfileCard key={profile.id} profile={profile} active={profile.id === activeId} dragHover={profile.id === dragHoverId} busy={busy} testing={testingId === profile.id} activationEpoch={activationEpoch} coldStart={coldStart} balanceCache={balanceCache} onEdit={() => void openEdit(profile)} onApply={() => void applyProfile(profile)} onDuplicate={() => void duplicateProfile(profile)} onTest={() => void testProfile(profile)} onRemove={() => void deleteProfile(profile)} />
                  );
                })}
              </div>
            </SortableContext>
            {createPortal(
              <DragOverlay dropAnimation={null}>
                {draggedProfile ? <ClaudeDragPreview profile={draggedProfile} width={dragWidth} height={dragHeight} active={draggedProfile.id === activeId} busy={busy} balanceCache={balanceCache} /> : null}
              </DragOverlay>,
              document.body,
            )}
          </DndContext>
        )}
      </div>
      <AppDialog open={captureOpen} onOpenChange={setCaptureOpen} title={tProfiles("dialog.captureTitle")} initialFocusRef={captureNameInput} footer={<><button type="button" className="apple-action-button" onClick={() => setCaptureOpen(false)}>{tProfiles("dialog.cancel")}</button><button type="button" className="apple-action-button app-button--primary" disabled={busy || !captureName.trim()} onClick={() => void capture()}>{tProfiles("dialog.save")}</button></>}>
        <div className="space-y-4"><p className="muted text-sm">{t("captureDescription")}</p><input ref={captureNameInput} className="app-input" maxLength={50} placeholder={tProfiles("edit.namePlaceholder")} value={captureName} onChange={(event) => setCaptureName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void capture(); }} /></div>
      </AppDialog>
    </section>
  );
}

// 卡片测试连通的门控：地址与 Token 都已设置才可测（has_token 由后端摘要提供）
function profileConnectionGate(profile: ClaudeProfileSummary, t: TFunction<"claude">) {
  const disabled = !profile.base_url || !profile.has_token;
  return { disabled, title: disabled ? t("checkProviderFields") : t("testConnection") };
}

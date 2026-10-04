import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../../api";
import { authQuotaErrorKind, profileAuthQuotaCacheKey } from "../../app/authQuotaCache";
import { balanceQueryProviders } from "../../presets";
import type { ProfileBalanceInfo, CodexProfileSummary } from "../../types";
import { useFeedback } from "../../app/Feedback";
import SortableCard from "../../components/SortableCard";
import { ProfileCardActions, ProfileCardContent, connectionGate } from "../profiles/ProfileCard";
import { useProfileBalance } from "../profiles/useProfileBalance";

interface ProfileCardProps {
  profile: CodexProfileSummary;
  active: boolean;
  dragHover?: boolean;
  busy: boolean;
  activationEpoch: number;
  /// 本次进程启动还没走完（首屏尚未出窗）——只有这时才值得把余额刷新往后放
  coldStart: boolean;
  balanceCache?: Record<string, ProfileBalanceInfo>;
  onApply: () => void;
  onRename: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

/** Codex 侧壳：官方订阅（无第三方 provider）不做门控；第三方供应商映射到通用判定。 */
export function profileConnectionGate(profile: CodexProfileSummary, t: TFunction<"profiles">) {
  if (!profile.provider) return { disabled: false, title: t("connection.test") };
  return connectionGate(profile.has_base_url, profile.has_key, {
    ready: t("connection.test"),
    missingEndpoint: t("connection.missingApiEndpointWarning"),
    missingKey: t("connection.missingApiKeyWarning"),
  });
}

export default function CodexProfileCard({
  profile,
  active,
  dragHover = false,
  busy,
  activationEpoch,
  coldStart,
  balanceCache,
  onApply,
  onRename,
  onEdit,
  onRemove,
  onDuplicate,
}: ProfileCardProps) {
  const feedback = useFeedback();
  const { t } = useTranslation("profiles");
  const authQuotaKey = profileAuthQuotaCacheKey(profile);
  const [testing, setTesting] = useState(false);
  const supportsBalance = profile.kind === "official" || balanceQueryProviders.has(profile.provider ?? "");
  const { balanceInfos, balanceError, balanceRefreshing, refreshBalance } = useProfileBalance({
    profileId: profile.id,
    showBalance: profile.show_balance,
    supportsBalance,
    hasCredential: profile.kind === "official" || profile.has_key,
    active,
    activationEpoch,
    coldStart,
    cachedBalance: balanceCache?.[profile.id],
    authQuotaKey,
    source: "codex",
  });

  // 测连通失败文案：凭证失效的结局走本地化可行动文案，其余保留后端原文
  const connectionFailureToast = (error: string) =>
    authQuotaErrorKind(error) === "auth_expired"
      ? t("connection.testFailed", { error: t("balance.authInvalidToast") })
      : t("connection.failed", { error });

  const testConnection = async () => {
    if (testing) return;
    if (profile.provider && !profile.has_base_url) {
      feedback.warning(t("edit.baseUrlRequired"));
      return;
    }
    if (profile.provider && !profile.has_key) {
      feedback.warning(t("connection.missingApiKeyWarning"));
      return;
    }
    setTesting(true);
    try {
      const result = await api.codexTestProfileConnection(profile.id);
      if (result.ok) {
        feedback.success(t("connection.ok", { latency: result.latency_ms != null ? ` · ${result.latency_ms}ms` : "" }));
      } else {
        feedback.error(connectionFailureToast(result.error ?? t("connection.unknownError")));
      }
    } catch (error) {
      feedback.error(connectionFailureToast(String(error)));
    } finally {
      setTesting(false);
    }
  };

  const connection = profileConnectionGate(profile, t);
  return (
    <SortableCard id={profile.id} active={active} dragHover={dragHover} onClick={onEdit} title={t("card.clickToEdit")} handleTitle={t("card.dragToReorder")}>
      <ProfileCardContent
        profile={profile}
        hideModel
        balanceInfos={balanceInfos}
        balanceError={balanceError}
        balanceRefreshing={balanceRefreshing}
        onRefreshBalance={refreshBalance}
        onOpenAdmin={() => void api.openUrl(profile.admin_url!).catch((error) => feedback.error(String(error)))}
        onRename={onRename}
      />
      <ProfileCardActions model={profile.model} reasoningEffort={profile.reasoning_effort} active={active} busy={busy} allowInactiveDeleteWhileBusy testing={testing} connectionDisabled={connection.disabled} connectionTitle={connection.title} onApply={onApply} onDuplicate={onDuplicate} onTest={() => void testConnection()} onRemove={onRemove} />
    </SortableCard>
  );
}

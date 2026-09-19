import { useTranslation } from "react-i18next";
import type { ProfileAdvancedPatches } from "./useProfileAdvancedPatches";

/** 编辑器 config 标签栏右侧的高级配置控件：长上下文 / 上下文管理 / 系统代理。 */
export default function ProfileAdvancedControls({ advanced, saving }: { advanced: ProfileAdvancedPatches; saving: boolean }) {
  const { t } = useTranslation("profiles");
  return (
    <>
      {advanced.showLongContextOverride ? (
        <div className={`flex h-8 items-center overflow-hidden rounded-[10px] border text-xs transition-colors ${advanced.longContextEnabled ? "border-accent/30 bg-accent/10" : "border-[var(--panel-ring)]"}`}>
          <label className={`flex h-full cursor-pointer items-center gap-2 px-2.5 transition-colors ${advanced.longContextEnabled ? "text-accent" : ""}`} title={t("edit.longContextTitle")}>
            <input type="checkbox" checked={advanced.longContextEnabled} disabled={advanced.patchingLongContext || saving} onChange={(event) => void advanced.toggleLongContext(event.target.checked)} />
            <span className="whitespace-nowrap font-medium">{t("edit.longContextLabel")}</span>
          </label>
          <label className={`flex h-full items-center gap-1.5 border-l border-[var(--panel-divider)] px-2.5 transition-opacity ${advanced.longContextEnabled ? "" : "opacity-40"}`} title={t("edit.compactLimitTitle")}>
            <span className="whitespace-nowrap">{t("edit.compactLimitLabel")}</span>
            <input className="app-input app-input--compact compact-token-input h-6 text-center" type="number" min={1} max={1_000_000} step={1} inputMode="numeric" value={advanced.compactTokenLimit} disabled={!advanced.longContextEnabled || advanced.patchingLongContext || saving} onChange={(event) => advanced.updateCompactTokenLimitInput(event.target.value)} onBlur={() => void advanced.updateCompactTokenLimit()} />
          </label>
        </div>
      ) : null}
      <label
        className={`flex h-8 items-center gap-2 rounded-[10px] border px-2.5 text-xs transition-colors ${advanced.contextMgmtEnabled ? "border-accent/30 bg-accent/10 text-accent" : "border-[var(--panel-ring)]"}`}
        title={t("edit.contextMgmtTitle")}
      >
        <input type="checkbox" checked={advanced.contextMgmtEnabled} disabled={advanced.patchingContextMgmt || saving} onChange={(event) => void advanced.toggleContextManagement(event.target.checked)} />
        <span className="whitespace-nowrap font-medium">{t("edit.contextMgmtLabel")}</span>
        <span className="meta-xs muted">{t("edit.experimental")}</span>
      </label>
      <label className={`flex h-8 items-center gap-2 rounded-[10px] border px-2.5 text-xs transition-colors ${advanced.systemProxyEnabled ? "border-accent/30 bg-accent/10 text-accent" : "border-[var(--panel-ring)]"}`} title={t("edit.systemProxyTitle")}>
        <input type="checkbox" checked={advanced.systemProxyEnabled} disabled={advanced.patchingSystemProxy || saving} onChange={(event) => void advanced.toggleSystemProxy(event.target.checked)} />
        <span className="whitespace-nowrap font-medium">{t("edit.systemProxyLabel")}</span>
      </label>
    </>
  );
}

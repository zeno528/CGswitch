import { RotateCcw } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export const claudeEffortLevels = ["low", "medium", "high", "xhigh", "max"] as const;
export const codexEffortLevels = [...claudeEffortLevels, "ultra"] as const;

export function isOverEffortThumb(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, x: number, y: number) {
  return Math.hypot(x - rect.left - rect.width / 2, y - rect.top - rect.height / 2) <= rect.width / 2;
}

export function ReasoningEffortSlider({ value, levels, onChange, onCommit, onReset, children, leading, fast = false, disabled = false }: {
  value: string;
  levels: readonly string[];
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  onReset?: () => void;
  children?: ReactNode;
  leading?: ReactNode;
  fast?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation("profiles");
  const labelId = useId();
  const index = levels.indexOf(value);
  const labelLevels = [...new Set(["", ...levels, value])];
  const showParticles = fast || value === "ultra";
  return (
    <div className="reasoning-effort-slider" data-selected={index >= 0} style={{
      "--effort-color": value === "ultra" ? "var(--reasoning-ultra)" : value ? "var(--accent)" : "var(--text-secondary)",
      "--effort-progress": index < 0 ? 0 : index / Math.max(1, levels.length - 1),
      "--effort-energy": index < 0 ? 0 : 0.3 + index / Math.max(1, levels.length - 1) * 0.7,
      "--effort-particle-duration": value === "ultra" ? "0.9s" : "1s",
    } as CSSProperties}>
      <div className="reasoning-effort-slider__header">
        <div className="reasoning-effort-slider__leading">{leading}</div>
        <div className="reasoning-effort-slider__heading">
          <strong id={labelId} className="field-label">
            <span className="sr-only">{t("modelSelection.effort")}: {value ? value[0].toUpperCase() + value.slice(1) : t("modelSelection.default")}</span>
            <span className="reasoning-effort-slider__label" aria-hidden="true">
              {labelLevels.map((level) => (
                <span key={level} className="reasoning-effort-slider__label-step" data-current={level === value}
                  style={{ transform: `translateY(${(levels.indexOf(level) - index) * 50}%)` }}>
                  {level ? level[0].toUpperCase() + level.slice(1) : t("modelSelection.default")}
                </span>
              ))}
            </span>
          </strong>
          {children}
          {fast && value === "ultra" && <span className="reasoning-effort-slider__quota-hint" aria-hidden="true">{t("modelSelection.ultraQuotaHint")}</span>}
        </div>
        <button type="button" className="apple-icon-button" disabled={disabled || (!value && !onReset)}
          title={t("modelSelection.resetEffort")} aria-label={t("modelSelection.resetEffort")}
          onClick={() => { if (onReset) onReset(); else { onChange(""); onCommit?.(""); } }}><RotateCcw size={16} aria-hidden="true" /></button>
      </div>
      <div className="reasoning-effort-slider__track" onPointerMove={(event) => {
        const track = event.currentTarget;
        const thumb = track.querySelector<HTMLElement>(".reasoning-effort-slider__thumb")!;
        track.toggleAttribute("data-thumb-hover", event.pointerType === "mouse"
          && isOverEffortThumb(thumb.getBoundingClientRect(), event.clientX, event.clientY));
        // 仅按住主键且在移动（真拖动）才算抓紧；单击、长按不动不显示。
        track.toggleAttribute("data-thumb-drag", !disabled && (event.buttons & 1) === 1);
      }} onPointerLeave={(event) => {
        event.currentTarget.removeAttribute("data-thumb-hover");
        event.currentTarget.removeAttribute("data-thumb-drag");
      }}>
        <span className="reasoning-effort-slider__fill" aria-hidden="true">
          {fast && value === "ultra" && <span className="reasoning-effort-slider__gradient" />}
          {showParticles && <span className="reasoning-effort-slider__particles" data-floating={!fast} />}
        </span>
        <div className="reasoning-effort-slider__stops">
          {levels.map((level, stop) => (!showParticles || stop > index) && (
            <button key={level} type="button" className="reasoning-effort-slider__stop" tabIndex={-1} disabled={disabled}
              aria-label={`${t("modelSelection.effort")}: ${level}`} title={level} aria-pressed={value === level}
              data-filled={stop <= index}
              style={{ "--effort-progress": stop / Math.max(1, levels.length - 1) } as CSSProperties}
              onClick={() => { onChange(level); onCommit?.(level); }}><span aria-hidden="true" /></button>
          ))}
        </div>
        <span className="reasoning-effort-slider__thumb-rail" aria-hidden="true"><span className="reasoning-effort-slider__thumb" /></span>
        <input type="range" min={0} max={Math.max(0, levels.length - 1)} step={1}
        value={Math.max(0, index)} disabled={levels.length === 0} aria-disabled={disabled || levels.length === 0}
        aria-labelledby={labelId} aria-valuetext={value || t("modelSelection.default")}
        // 保存时保留焦点，拦住输入，避免 disabled 触发失焦后再重复聚焦。
        onPointerDown={(event) => { if (disabled) event.preventDefault(); }}
        onKeyDown={(event) => { if (disabled && event.key !== "Tab") event.preventDefault(); }}
        onChange={(event) => { if (!disabled && levels.length) onChange(levels[Number(event.target.value)]); }}
        onPointerUp={(event) => {
          event.currentTarget.closest<HTMLElement>(".reasoning-effort-slider__track")?.removeAttribute("data-thumb-drag");
          if (!disabled && levels.length) {
            const next = levels[Number(event.currentTarget.value)];
            onChange(next);
            onCommit?.(next);
          }
        }}
        onKeyUp={(event) => {
          if (!disabled && levels.length && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            const next = levels[Number(event.currentTarget.value)];
            onChange(next);
            onCommit?.(next);
          }
        }} onBlur={() => { if (!disabled && index >= 0) onCommit?.(value); }} />
      </div>
    </div>
  );
}

import { Check, ChevronRight, Zap } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../app/Feedback";
import { ReasoningEffortSlider } from "../../components/ReasoningEffortSlider";
import { useFixedMenuPosition } from "../../components/useFixedMenuPosition";
import { useMenuDismiss } from "../../components/useMenuDismiss";

interface ModelSelection { model: string; effort: string; fast?: boolean }
export interface ModelSelectionOptions extends ModelSelection {
  models: string[];
  efforts?: Record<string, string[] | undefined>;
}

export function selectModel(model: string, effort: string, advertised?: readonly string[]): ModelSelection {
  return { model, effort: advertised && !advertised.includes(effort) ? "" : effort };
}

const modelLabel = (value: string, format?: (value: string) => string) => (format ? format(value) : value).replace(/^gpt-/i, "GPT-")
  .replace(/-(sol|astra|luna|terra)$/i, (_, name: string) => " " + name[0].toUpperCase() + name.slice(1));

export default function ProfileModelSelector({ model, effort, levels, disabled, supportsFastMode = false, fast = false, formatModelLabel, onLoad, onSave }: {
  model: string | null;
  effort: string | null;
  levels: readonly string[];
  disabled: boolean;
  supportsFastMode?: boolean;
  fast?: boolean;
  formatModelLabel?: (value: string) => string;
  onLoad: () => Promise<ModelSelectionOptions>;
  onSave: (changes: Partial<ModelSelection>) => Promise<void>;
}) {
  const { t } = useTranslation("profiles");
  const feedback = useFeedback();
  const [view, setView] = useState<"effort" | "models" | null>(null);
  const [options, setOptions] = useState<ModelSelectionOptions | null>(null);
  const [draft, setDraft] = useState<ModelSelection>({ model: "", effort: "" });
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuWidth = view === "models" ? "17rem" : "16rem";
  const menuStyle = useFixedMenuPosition(view !== null, triggerRef.current, menuRef, "end", menuWidth);
  const close = useCallback(() => setView(null), []);
  useMenuDismiss(view !== null, triggerRef, menuRef, close);
  useLayoutEffect(() => {
    if (!view) return;
    const target = menuRef.current?.querySelector<HTMLElement>(view === "models" ? '[aria-selected="true"]' : 'input[type="range"]');
    target?.focus({ preventScroll: true });
    if (view === "models") target?.scrollIntoView({ block: "nearest" });
  }, [view]);
  const open = async () => {
    if (view) { setView(null); return; }
    setBusy(true);
    try {
      const loaded = await onLoad();
      setDraft({ model: loaded.model, effort: loaded.effort, fast: loaded.fast });
      setOptions(loaded);
      setView("effort");
    } catch (error) { feedback.error(String(error)); }
    finally { setBusy(false); }
  };
  const commit = async (next: ModelSelection) => {
    if (!options || busy || disabled || (next.model === options.model && next.effort === options.effort && next.fast === options.fast)) return;
    setDraft(next);
    setBusy(true);
    try {
      await onSave({
        ...(next.model !== options.model ? { model: next.model } : {}),
        ...(next.effort !== options.effort ? { effort: next.effort } : {}),
        ...(supportsFastMode && next.fast !== options.fast ? { fast: next.fast } : {}),
      });
      setOptions({ ...options, ...next });
    } catch (error) {
      setDraft({ model: options.model, effort: options.effort, fast: options.fast });
      feedback.error(String(error));
    } finally { setBusy(false); }
  };
  const pickModel = async (value: string) => {
    const next = { ...draft, ...selectModel(value, draft.effort, options?.efforts?.[value]) };
    await commit(next);
    setView((current) => current === "models" ? "effort" : current);
  };
  const availableLevels = options?.efforts?.[draft.model] ?? levels;
  const models = [...new Set([options?.model ?? "", ...(options?.models ?? [])])].filter(Boolean);
  return (
    <div className="contents" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}>
      <button ref={triggerRef} type="button" className="profile-card-action-meta profile-model-trigger" disabled={disabled || busy}
        title={t("modelSelection.title")} aria-haspopup="dialog" aria-expanded={view !== null} aria-busy={busy} onClick={() => void open()}>
        {supportsFastMode && (view ? draft.fast : fast) && <Zap size={14} fill="currentColor" className="shrink-0" role="img" aria-label={t("modelSelection.fastMode")} />}
        <span className="profile-card-action-meta__model">{modelLabel((view ? draft.model : model) || t("modelSelection.default"), formatModelLabel)}</span>
        <span aria-hidden="true">·</span><span>{(view ? draft.effort : effort) || t("modelSelection.default")}</span>
      </button>
      {view && options && createPortal(
        <div ref={menuRef} className="app-select-menu app-popover profile-model-popover" data-open="true" data-popover-in
          role="dialog" aria-label={t("modelSelection.title")} aria-busy={busy} style={{ ...menuStyle, width: menuWidth }}>
          {view === "effort" ? <ReasoningEffortSlider value={draft.effort} levels={availableLevels} disabled={busy || disabled}
            fast={supportsFastMode && !!draft.fast}
            leading={supportsFastMode ? <button type="button" className="apple-icon-button profile-model-fast"
              style={{ color: draft.fast && draft.effort === "ultra" ? "var(--reasoning-ultra)" : undefined }}
              disabled={busy || disabled} aria-pressed={!!draft.fast} title={t("modelSelection.fastMode")} aria-label={t("modelSelection.fastMode")}
              onClick={() => void commit({ ...draft, fast: !draft.fast })}><Zap size={18} fill={draft.fast ? "currentColor" : "none"} aria-hidden="true" /></button> : undefined}
            onChange={(value) => setDraft({ ...draft, effort: value })} onCommit={(value) => void commit({ ...draft, effort: value })}>
            <button type="button" className="profile-model-current field-label" disabled={busy || disabled}
              aria-haspopup="listbox" onClick={() => setView("models")}>
              <span>{modelLabel(draft.model || t("modelSelection.default"))}</span><ChevronRight size={14} aria-hidden="true" />
            </button>
          </ReasoningEffortSlider> : <>
            <div className="profile-model-list-title muted">{t("modelSelection.chooseModel")}</div>
            <div role="listbox" aria-label={t("modelSelection.chooseModel")} onKeyDown={(event) => {
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
            }}>
              {["", ...models].map((value) => (
                <button key={value} type="button" role="option" aria-selected={draft.model === value} disabled={busy || disabled}
                  className="app-select-option app-selection-state profile-model-option" onClick={() => void pickModel(value)}>
                  <span className="min-w-0"><span className="block truncate">{modelLabel(value || t("modelSelection.default"))}</span>
                    {!!value && draft.effort && options.efforts?.[value] && !options.efforts[value]!.includes(draft.effort)
                      && <span className="meta-xs muted">{t("modelSelection.useDefaultEffort")}</span>}
                  </span>
                  {draft.model === value && <Check size={18} className="muted" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </>}
        </div>, document.body,
      )}
    </div>
  );
}

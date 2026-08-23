import { ArrowLeft, Save } from "lucide-react";
import { useState } from "react";
import { providerIconThemeClass, providerIcons } from "../../icons";

interface ProfileIconEditProps {
  icon: string | null;
  onBack: () => void;
  onSave: (icon: string | null) => void;
}

export default function ProfileIconEdit({ icon, onBack, onSave }: ProfileIconEditProps) {
  const [selected, setSelected] = useState<string | null>(icon);
  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col">
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header">
        <button type="button" className="apple-page-header apple-back-button" aria-label="返回" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" />
          <span className="apple-title">选择供应商图标</span>
        </button>
      </div>
      <div className="apple-edit-content">
        <div className="apple-group p-[var(--gap-card)]">
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
            {providerIcons.map((current) => (
              <button
                key={current.id}
                type="button"
                className={`flex flex-col items-center gap-1 rounded-lg px-1.5 py-2 transition-colors ${selected === current.id ? "shadow-[0_0_0_1px_var(--accent)] bg-[var(--selection-bg)]" : "shadow-[0_0_0_1px_var(--panel-ring)] hover:bg-black/3 dark:hover:bg-white/4"}`}
                aria-pressed={selected === current.id}
                onClick={() => setSelected(current.id)}
              >
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--tile-bg)]" aria-hidden="true"><img src={current.url} alt={current.label} className={`h-4 w-4 ${providerIconThemeClass(current.id)}`} /></span>
                <span className="w-full truncate text-center text-xs">{current.label}</span>
              </button>
            ))}
          </div>
          <button type="button" className={`mt-3 w-full rounded-lg border border-dashed px-2 py-2.5 text-xs transition-colors ${selected === null ? "border-accent font-medium text-accent" : "muted border-[var(--panel-border)] hover:bg-black/3 dark:hover:bg-white/4"}`} aria-pressed={selected === null} onClick={() => setSelected(null)}>
            不使用图标（显示名称首字）
          </button>
        </div>
      </div>
      <div className="apple-edit-toolbar apple-edit-toolbar--footer">
        <button type="button" className="apple-action-button" onClick={onBack}>取消</button>
        <button type="button" className="apple-action-button app-button--primary" onClick={() => onSave(selected)}>
          <Save className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> 保存
        </button>
      </div>
    </section>
  );
}

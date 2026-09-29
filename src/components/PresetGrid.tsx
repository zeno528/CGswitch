import type { BuiltinPreset } from "../presets";
import { ProfileIconTile } from "./ProfileIconTile";

interface PresetGridProps {
  presets: readonly BuiltinPreset[];
  selectedKind: string;
  onSelect: (kind: string) => void;
  title: string;
}

/** 创建态预设选择网格（图标 + 名称，选中描边）：Codex / Claude Code 编辑页共用。 */
export default function PresetGrid({ presets, selectedKind, onSelect, title }: PresetGridProps) {
  return (
    <div className="apple-panel-section">
      <div className="field-subtitle">{title}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3 md:grid-cols-6">
        {presets.map((preset) => (
          <button
            key={preset.kind}
            type="button"
            className={`flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors ${selectedKind === preset.kind ? "shadow-[0_0_0_1px_var(--accent)]" : "shadow-[0_0_0_1px_var(--panel-ring)] hover:bg-black/3 dark:hover:bg-white/4"}`}
            aria-pressed={selectedKind === preset.kind}
            onClick={() => onSelect(preset.kind)}
          >
            <ProfileIconTile name={preset.name} icon={preset.icon} size="xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold tracking-tight">{preset.name}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

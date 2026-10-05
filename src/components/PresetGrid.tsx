import type { ClientPreset } from "../presets";
import { ProfileIconTile } from "./ProfileIconTile";

interface PresetGridProps {
  presets: readonly ClientPreset[];
  selectedKind: string;
  onSelect: (kind: string) => void;
  title: string;
}

/** 创建态预设选择网格（图标 + 名称，选中描边）：Codex / Claude Code 编辑页共用。
 *  不套卡片框：编辑正文由 apple-edit-surface 承载、刻意无卡片外观，区块之间靠分隔线分区，
 *  这里再加一层圆角描边只会把末行的空当圈起来，并多出一级包装深度。 */
export default function PresetGrid({ presets, selectedKind, onSelect, title }: PresetGridProps) {
  return (
    <div className="apple-panel-section">
      <div className="field-subtitle">{title}</div>
      <div className="apple-tile-grid apple-tile-grid--labeled mt-3">
        {presets.map((preset) => (
          <button
            key={preset.kind}
            type="button"
            className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors ${selectedKind === preset.kind ? "shadow-[0_0_0_1px_var(--accent)] bg-(--active-bg)" : "hover:bg-(--hover-bg)"}`}
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

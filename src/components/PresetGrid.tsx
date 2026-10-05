import { Check, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import type { ClientPreset, PresetEndpoint } from "../presets";
import { ProfileIconTile } from "./ProfileIconTile";

interface PresetGridProps {
  presets: readonly ClientPreset[];
  selectedKind: string;
  onSelect: (kind: string, endpoint?: PresetEndpoint) => void;
  title: string;
  endpointTitle: string;
  baseUrl: string;
  regionCn: string;
  regionGlobal: string;
}

/** 创建态预设选择网格（图标 + 名称，选中描边）：Codex / Claude Code 编辑页共用。
 *  不套卡片框：编辑正文由 apple-edit-surface 承载、刻意无卡片外观，区块之间靠分隔线分区，
 *  这里再加一层圆角描边只会把末行的空当圈起来，并多出一级包装深度。 */
export default function PresetGrid({ presets, selectedKind, onSelect, title, endpointTitle, baseUrl, regionCn, regionGlobal }: PresetGridProps) {
  const [expandedKind, setExpandedKind] = useState<string | null>(null);
  const panelId = useId();
  const expandedPreset = presets.find((preset) => preset.kind === expandedKind && preset.kind === selectedKind);
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
            aria-expanded={preset.endpoints && preset.endpoints.length > 1 ? expandedPreset?.kind === preset.kind : undefined}
            aria-controls={preset.endpoints && preset.endpoints.length > 1 ? panelId : undefined}
            onClick={() => {
              setExpandedKind(expandedKind === preset.kind ? null : preset.kind);
              if (selectedKind !== preset.kind) onSelect(preset.kind);
            }}
          >
            <ProfileIconTile name={preset.name} icon={preset.icon} size="xs" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold tracking-tight">{preset.name}</span>
            </span>
            {preset.endpoints && preset.endpoints.length > 1 ? (
              <ChevronRight size={16} strokeWidth={2} aria-hidden="true" className={expandedPreset?.kind === preset.kind ? "shrink-0 rotate-90" : "shrink-0"} />
            ) : null}
          </button>
        ))}
      </div>
      <div id={panelId} hidden={!expandedPreset?.endpoints || expandedPreset.endpoints.length < 2}>
        {expandedPreset?.endpoints && expandedPreset.endpoints.length > 1 ? (
          <div className="mt-4">
            <div className="field-label mb-1.5">{endpointTitle}</div>
            <div className="grid gap-2">
              {expandedPreset.endpoints.map((endpoint) => (
                <button
                  key={endpoint.base_url}
                  type="button"
                  className="app-select-option app-selection-state"
                  data-active={baseUrl === endpoint.base_url ? "true" : undefined}
                  aria-pressed={baseUrl === endpoint.base_url}
                  onClick={() => onSelect(expandedPreset.kind, endpoint)}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <span className="field-label block">{endpoint.region === "cn" ? regionCn : regionGlobal}{endpoint.label ? ` · ${endpoint.label}` : ""}</span>
                    <span className="meta-xs muted block truncate">{endpoint.base_url}</span>
                  </div>
                  {baseUrl === endpoint.base_url ? <Check size={16} strokeWidth={2} className="app-select-option__check" aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { Puzzle } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import type { SkillSummary } from "../../types";

export default function SkillsView() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  const refresh = async () => {
    try {
      setSkills(await api.listSkills());
      setLoadError("");
    } catch (error) {
      setLoadError(String(error));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { void refresh(); }, []);

  return (
    <section className="apple-scroll-page mx-auto w-full max-w-none">
      <header className="apple-page-bar justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-accent">
            <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
          <div className="flex items-center gap-2">
            <div className="apple-title">Skill</div>
            {loaded ? <span className="apple-chip" aria-label={`${skills.length} 个 Skill`}>{skills.length}</span> : <LoadingSpinner />}
          </div>
        </div>
      </header>
      <div className="apple-edit-content">
        {loadError ? <p className="muted mt-4 text-sm">{loadError}</p> : null}
        {loaded && skills.length === 0 ? (
          <div className="apple-group py-14 text-center">
            <p className="muted">Codex 当前没有发现独立 Skill。</p>
          </div>
        ) : skills.length ? (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div key={skill.name} className="apple-list-row">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{skill.name}</div>
                  <div className="muted meta-xs truncate">{skill.description ?? "暂无 Skill 描述"}</div>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <span className="mono muted meta-xs truncate">{skill.store_path}</span>
                    {skill.source_url ? <span className="muted meta-xs truncate">{skill.source_url}</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

import type { ReactNode } from "react";
import { LoadingSpinner } from "./LoadingSpinner";
import { SkillTargetLogo } from "./SkillTargetLogo";

interface ManagementTargetCounts {
  codex: number;
  claude: number;
  codexLabel: string;
  claudeLabel: string;
}

interface ManagementPageTitleProps {
  icon: ReactNode;
  title: string;
  count?: number;
  countLabel?: string;
  loadingLabel?: string;
  targets?: ManagementTargetCounts;
  className?: string;
}

/** 插件、MCP、Skill 入口统一的标题 + 总数；双端计数按页面数据可选展示。 */
export function ManagementPageTitle({ icon, title, count, countLabel, loadingLabel, targets, className = "" }: ManagementPageTitleProps) {
  // count 未就绪即在加载，调用方不必各自推导 loading。
  const loading = count === undefined;
  return (
    <span className={`management-page-title ${className}`}>
      {icon}
      <span className="apple-title management-page-title__label">
        <span>{title}</span>
        {loading ? <span className="text-accent" role="status" aria-label={loadingLabel}><LoadingSpinner size="md" /></span> : count !== undefined ? <span className="management-page-title__count" title={countLabel} aria-label={countLabel}><span aria-hidden="true">·</span><span>{count}</span></span> : null}
      </span>
      {targets ? (
        <span className="management-page-title__targets">
          <span className="management-page-title__target" role="img" aria-label={targets.claudeLabel}>
            <SkillTargetLogo target="claude" variant="title" />
            <span>{targets.claude}</span>
          </span>
          <span className="management-page-title__target" role="img" aria-label={targets.codexLabel}>
            <SkillTargetLogo target="codex" variant="title" />
            <span>{targets.codex}</span>
          </span>
        </span>
      ) : null}
    </span>
  );
}

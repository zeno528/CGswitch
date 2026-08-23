import type { ReactNode } from "react";
import { LoadingSpinner } from "./LoadingSpinner";

export function EmptyStateCard({ icon, children, loading = false }: { icon: ReactNode; children: ReactNode; loading?: boolean }) {
  return (
    <div className="apple-group flex flex-col items-center justify-center gap-2 px-6 py-6 text-center" role={loading ? "status" : undefined} aria-busy={loading || undefined}>
      <span className="settings-icon-tile grid h-10 w-10 place-items-center rounded-xl text-accent" aria-hidden="true">
        {loading ? <LoadingSpinner size="md" /> : icon}
      </span>
      {loading ? <span className="muted text-sm">正在加载…</span> : children}
    </div>
  );
}

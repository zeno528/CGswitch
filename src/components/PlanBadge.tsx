export function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan) return null;
  const label = plan === "k12" ? "K12" : plan.charAt(0).toUpperCase() + plan.slice(1);
  return <span className="plan-badge">{label}</span>;
}

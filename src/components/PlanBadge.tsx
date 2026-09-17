import { Crown, Star, Users } from "lucide-react";

// 订阅套餐徽标（统一样式见 style.css .plan-badge），档位只靠图标区分：
// Free 无图标；Plus 星 / Pro 皇冠；team/business/go/k12 共用群组图标。
const tierIcons = {
  plus: Star,
  pro: Crown,
  team: Users,
} as const;

export function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan) return null;
  const label = plan === "k12" ? "K12" : plan.charAt(0).toUpperCase() + plan.slice(1);
  const Icon = tierIcons[plan as keyof typeof tierIcons];
  return (
    <span className="plan-badge">
      {Icon ? <Icon size={10} aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

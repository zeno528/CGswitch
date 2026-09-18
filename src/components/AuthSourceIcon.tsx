import { Monitor, type LucideProps, UserRoundCheck } from "lucide-react";

export type AuthSourceIconSource = "desktop" | "oauth";

export function AuthSourceIcon({ source, ...props }: LucideProps & { source: AuthSourceIconSource }) {
  const Icon = source === "desktop" ? Monitor : UserRoundCheck;
  return <Icon {...props} />;
}

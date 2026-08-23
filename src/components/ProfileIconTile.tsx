import { providerIconThemeClass, providerIconUrl } from "../icons";

interface ProfileIconTileProps {
  name: string;
  icon: string | null;
  size?: "xs" | "sm" | "fill" | "lg";
}

const sizes = {
  xs: { tile: "h-8 w-8 rounded-[10px]", image: "h-4 w-4", text: "meta-xs" },
  sm: { tile: "h-10 w-10 rounded-[12px]", image: "h-6 w-6", text: "text-sm" },
  fill: { tile: "h-full w-full rounded-[16px]", image: "h-8 w-8", text: "text-2xl" },
  lg: { tile: "h-[76px] w-[76px] rounded-[22px]", image: "h-10 w-10", text: "text-xl" },
} as const;

export function ProfileIconTile({ name, icon, size = "sm" }: ProfileIconTileProps) {
  const current = sizes[size];
  const iconUrl = providerIconUrl(icon);
  return (
    <span className={`grid shrink-0 place-items-center bg-[var(--tile-bg)] ${current.tile}`} aria-hidden="true">
      {iconUrl ? <img src={iconUrl} alt="" className={`${current.image} ${providerIconThemeClass(icon)}`} /> : <span className={`font-bold text-accent ${current.text}`}>{name.charAt(0)}</span>}
    </span>
  );
}

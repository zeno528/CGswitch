import { useTranslation } from "react-i18next";
import { containsLabels } from "../pluginMeta";

export default function ContainsChips({ items }: { items: string[] }) {
  const { t } = useTranslation("plugins");
  if (!items.length) return null;
  return (
    <span className="flex shrink-0 flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="rounded-md bg-black/5 px-1.5 py-px font-medium tracking-wide muted meta-xs dark:bg-white/10">
          {containsLabels[item] ? t(containsLabels[item]) : item}
        </span>
      ))}
    </span>
  );
}

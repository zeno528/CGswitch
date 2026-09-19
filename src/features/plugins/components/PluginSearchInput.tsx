import { Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export default function PluginSearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation("plugins");
  const inputRef = useRef<HTMLInputElement>(null);
  // Ctrl/Cmd+K 聚焦搜索框：window 级监听保证焦点在别处也生效，抢在浏览器站点搜索前 preventDefault
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <div className="relative w-44 shrink-0">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--text-secondary)" strokeWidth={2} />
      <input
        ref={inputRef}
        type="search"
        className="app-input app-input--pill"
        placeholder={t("list.searchPlaceholder")}
        aria-label={t("list.searchPlaceholder")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

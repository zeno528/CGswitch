import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../../api";
import { useFeedback } from "../../../app/Feedback";
import { GithubMark } from "../../../components/GithubMark";

function sourceUrl(source: string): string | null {
  const value = source.trim();
  if (/^https?:\/\//i.test(value)) return value.replace(/\.git$/i, "");
  const githubSsh = value.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/)(.+?)(?:\.git)?$/i);
  if (githubSsh) return `https://github.com/${githubSsh[1]}`;
  if (/^[^/\s]+\/[^/\s]+(?:@[^/\s]+)?$/.test(value)) {
    const [repository, reference] = value.split("@", 2);
    return `https://github.com/${repository}${reference ? `/tree/${reference}` : ""}`;
  }
  return null;
}

export default function SourceLink({ source }: { source: string }) {
  const feedback = useFeedback();
  const { t } = useTranslation("plugins");
  const url = sourceUrl(source);
  if (!url) return <span className="mono muted meta-xs break-all">{source}</span>;
  const isGithub = /github\.com/i.test(url);
  return (
    <button
      type="button"
      className={isGithub ? "shrink-0 p-1 text-accent" : "apple-inline-btn shrink-0"}
      title={t("source.openTitle", { url })}
      aria-label={isGithub ? t("source.openGithub") : t("source.openSource")}
      onClick={(event) => {
        event.stopPropagation();
        void api.openUrl(url).catch((error) => feedback.error(String(error)));
      }}
    >
      {isGithub ? <GithubMark /> : t("source.openSource")}
      {!isGithub && <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />}
    </button>
  );
}

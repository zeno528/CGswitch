import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ManagementPageTitle } from "./ManagementPageTitle";

describe("ManagementPageTitle", () => {
  it("renders the shared count and optional Codex/Claude count group", () => {
    const markup = renderToStaticMarkup(createElement(ManagementPageTitle, {
      icon: createElement("span"),
      title: "Skill",
      count: 81,
      targets: { codex: 36, claude: 35, codexLabel: "Codex 36", claudeLabel: "Claude 35" },
    }));
    expect(markup).toContain("Skill");
    expect(markup).toContain("·");
    expect(markup).toContain(">81<");
    expect(markup).not.toContain('src="/codex.svg"');
    expect(markup).not.toContain('src="/claude-code.svg"');
    expect(markup.match(/<svg/g)).toHaveLength(2);
    expect(markup).toContain(">36<");
    expect(markup).toContain(">35<");
  });
});

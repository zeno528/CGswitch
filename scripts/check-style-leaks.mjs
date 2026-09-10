// 样式泄漏扫描：拦截绕过 token / 全局类的新代码（发版前随 pnpm check 运行）。
// 规则来源见 AGENTS.md「样式准入」。白名单必须附带理由，且只允许 (文件, 类) 精确匹配。
// 字体栈单独有一条准入：style.css 里的 font-family 只允许引用 --font-ui / --font-mono，
// 组件里禁止出现 fontFamily（当年三处各写一套 Windows 优先栈就是这么攒出来的）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));

const WHITELIST = [
  { file: "features/mcp/McpView.tsx", class: "text-[10px]", reason: "MCP 传输类型徽标：低于 meta-xs 的特例字号" },
  { file: "features/profiles/ProfileEdit.tsx", class: "text-[13px]", reason: "编辑页 tab：介于 setting-title 与 field-label 之间的既有字号" },
  { file: "app/AppShell.tsx", class: "overflow-y-auto", reason: "<main> 本身：AGENTS.md 钦定的普通页唯一纵向滚动容器" },
  { file: "features/mcp/McpSyncDialog.tsx", class: "overflow-y-auto", reason: "Radix 弹窗 body 内部滚动（max-h-50vh）：弹窗不在页面流内" },
  { file: "features/skills/SkillsView.tsx", class: "overflow-auto", reason: "Skill 内容预览弹窗的长文本滚动：弹窗不在页面流内" },
  { file: "features/updates/UpdateNotesDialog.tsx", class: "overflow-auto", reason: "更新日志弹窗的长文本滚动（max-h-60vh）：弹窗不在页面流内" },
];

const RULES = [
  {
    name: "任意值字号（应使用层级类或 meta-xs）",
    pattern: /(?:^|[\s"'`])text-\[(\d+(?:\.\d+)?)(?:px|rem)\]/g,
    extract: (match) => match.trim(),
  },
  {
    name: "硬编码十六进制色（应使用语义 token，var(--…) 不受影响）",
    pattern: /(?:text|bg|border|fill|stroke|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/g,
    extract: (match) => match,
  },
  {
    name: "Tailwind CSS 变量简写（bg-[var(--…)] 应使用 bg-(--…)）",
    pattern: /(?:^|[\s"'`])(?:[a-z-]+:)*bg-\[var\(--[^)]*\)\](?:\/[^\s"'`}]+)?/g,
    extract: (match) => match.trim(),
  },
  {
    name: "Tailwind 中性灰（次要文字用 muted / text-[var(--text-secondary)]）",
    pattern: /(?:text|bg|border)-(?:zinc|gray|neutral|slate|stone)-\d+/g,
    extract: (match) => match,
  },
  {
    name: "首卡片页面间距（由 .apple-edit-content 的 padding-top 统一承担，页面禁止再叠 mt）",
    pattern: /mt-\[var\(--gap-page\)\]/g,
    extract: () => "mt-[var(--gap-page)]",
  },
  {
    name: "自造滚动容器 / sticky（纵向滚动只归 <main> 与 .apple-edit-content；页头吸顶用 apple-page-bar--sticky）",
    pattern: /(?:overflow(?:-x|-y)?-(?:auto|scroll)|overscroll-[a-z-]+|(?:^|[\s"'`])sticky(?:[\s"'`]|$))/g,
    extract: (match) => match.trim(),
  },
  {
    name: "内联字体栈（界面字体只允许 --font-ui / --font-mono，或直接继承，不要在组件里指定字体）",
    pattern: /fontFamily:\s*["'`]/g,
    extract: (match) => match.trim(),
  },
];

/* 字体栈准入：style.css 里的 font-family 只允许引用 --font-ui / --font-mono。
   曾有三处各写一套 Windows 优先栈（侧栏导航、输入框占位符、侧栏 wordmark），
   macOS 上前两者落不到 San Francisco，占位符还与输入文字不同字体。 */
const FONT_WHITELIST = [
  { text: 'font-family: "Segoe UI Variable Display", "Bahnschrift", "Segoe UI", -apple-system, sans-serif;', reason: "侧栏应用名 wordmark：刻意的品牌几何字体，末尾带 -apple-system 回退" },
];
/* 只取出声明，允许与否在代码里判：把排除项写进正则会被 \s* 的回溯绕过
   （「冒号后零空白」时否定断言成立，于是 var(--font-ui) 也被误判）。 */
const CSS_FONT_RULE = /font-family:\s*([^;]+);/g;
const ALLOWED_FONT_VALUES = /^var\(--font-(?:ui|mono)\)$/;
const CSS_PATH = fileURLToPath(new URL("../src/style.css", import.meta.url));

/* 文件级结构不变量：中间滚动区与页头必须成对出现，防止新页面漏页头或自建布局骨架 */
const STRUCTURAL_CHECKS = [
  {
    name: "使用 apple-edit-content 的文件必须同时包含 apple-page-bar",
    holds: (content) => content.includes("apple-page-bar"),
  },
];

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) entries.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) entries.push(full);
  }
  return entries;
}

const violations = [];
const files = walk(SRC_ROOT);
for (const filePath of files) {
  const rel = filePath.slice(SRC_ROOT.length + 1).replace(/\\/g, "/");
  const content = readFileSync(filePath, "utf8");
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(content))) {
      const klass = rule.extract(match[0]);
      const allowed = WHITELIST.some((w) => w.file === rel && w.class === klass);
      if (!allowed) violations.push({ rel, rule: rule.name, klass });
    }
  }
  if (content.includes("apple-edit-content")) {
    for (const check of STRUCTURAL_CHECKS) {
      if (!check.holds(content)) violations.push({ rel, rule: check.name, klass: "apple-edit-content" });
    }
  }
}

/* style.css 单独扫：上面的 RULES 面向 Tailwind 类名写法，直接套到原生 CSS 会误报（如 position: sticky）。 */
const usedFontWhitelist = new Set();
for (const match of readFileSync(CSS_PATH, "utf8").matchAll(CSS_FONT_RULE)) {
  const text = match[0].trim();
  const value = match[1].replace(/!\s*important\s*$/, "").trim();
  if (ALLOWED_FONT_VALUES.test(value)) continue;
  const entry = FONT_WHITELIST.find((item) => item.text === text);
  if (entry) usedFontWhitelist.add(entry.text);
  else violations.push({ rel: "style.css", rule: "字体栈（必须走 --font-ui / --font-mono）", klass: text });
}

const whitelistedUnknown = WHITELIST.filter(
  (w) => !files.some((f) => f.slice(SRC_ROOT.length + 1).replace(/\\/g, "/") === w.file),
);

if (violations.length) {
  console.error(`✖ 样式泄漏扫描发现 ${violations.length} 处：`);
  for (const v of violations) console.error(`  ${v.rel}: ${v.klass}  ← ${v.rule}`);
  console.error("处理方式：改用全局类/token；确属特例则加入脚本 WHITELIST 并写明理由。");
  process.exit(1);
}
if (whitelistedUnknown.length) {
  console.error(`✖ 白名单指向不存在的文件（已过期，请清理）：`);
  for (const w of whitelistedUnknown) console.error(`  ${w.file}: ${w.class}`);
  process.exit(1);
}
const staleFontWhitelist = FONT_WHITELIST.filter((item) => !usedFontWhitelist.has(item.text));
if (staleFontWhitelist.length) {
  console.error("✖ 字体白名单已过期（对应声明已改写或删除，请清理）：");
  for (const item of staleFontWhitelist) console.error(`  ${item.text}  ← ${item.reason}`);
  process.exit(1);
}
console.log("✔ 样式泄漏扫描通过（字号/色值/中性灰/首卡间距/滚动与 sticky/字体栈 均未越界，结构不变量成立）");

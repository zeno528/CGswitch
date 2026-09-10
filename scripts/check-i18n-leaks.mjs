// i18n 泄漏扫描：拦截绕过 t() 的中文字面量（随 pnpm check 运行）。
// 两级豁免：
//   1) 整文件 WHITELIST —— 尚未迁移的文件，写明分期，迁移一个摘一个；
//   2) 行内 `i18n-exempt: <理由>` —— 不能翻的单行（配置值、正则片段等），必须写清为什么。
// 白名单为空是终态；指向不存在文件时脚本报错，防止白名单腐烂。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));
/** 译文所在目录，其内容本身就是中文，不参与扫描。 */
const LOCALES_PREFIX = "i18n/locales";
/** 行内豁免标记，写在需要豁免的那一行上（行尾注释即可）。 */
const EXEMPT_MARK = "i18n-exempt";

/** 尚未迁移的文件。摘除顺序见 docs/i18n-glossary.md 的分期。 */
const WHITELIST = [
  { file: "api/web-mock.ts", reason: "浏览器调试桩，不随应用发行" },
];

const CJK = /[一-鿿]/;

/**
 * 去掉注释后只剩会被渲染或参与逻辑的代码。注释永远不可能显示给用户，必须剥离，
 * 否则行尾注释会被误报成「未走 t() 的中文」。
 * 块注释替换为等量空白并保留换行，保证行号与原文一致（行内豁免依赖行号对齐）。
 * 行尾注释要求 `//` 前有空白，避免把字符串里的 `https://` 当成注释起点。
 */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/.*$/gm, "");

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) entries.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) entries.push(full);
  }
  return entries;
}

const allowed = new Set(WHITELIST.map((item) => item.file));
const violations = [];
const files = walk(SRC_ROOT);

for (const filePath of files) {
  const rel = filePath.slice(SRC_ROOT.length + 1).replace(/\\/g, "/");
  if (rel.startsWith(LOCALES_PREFIX) || allowed.has(rel)) continue;
  const raw = readFileSync(filePath, "utf8");
  const exemptLines = new Set();
  raw.split("\n").forEach((line, index) => {
    if (line.includes(EXEMPT_MARK)) exemptLines.add(index);
  });
  stripComments(raw).split("\n").forEach((line, index) => {
    if (exemptLines.has(index) || !CJK.test(line)) return;
    violations.push({ rel, text: line.trim().slice(0, 80) });
  });
}

const staleWhitelist = WHITELIST.filter(
  (item) => !files.some((f) => f.slice(SRC_ROOT.length + 1).replace(/\\/g, "/") === item.file),
);

if (violations.length) {
  console.error(`✖ i18n 泄漏扫描发现 ${violations.length} 处未走 t() 的中文：`);
  for (const v of violations) console.error(`  ${v.rel}: ${v.text}`);
  console.error("处理方式：改用 t()；整文件尚未迁移进 WHITELIST，确属不能翻的单行加行尾 `// i18n-exempt: 理由`。");
  process.exit(1);
}
if (staleWhitelist.length) {
  console.error("✖ 白名单指向不存在的文件（已过期，请清理）：");
  for (const item of staleWhitelist) console.error(`  ${item.file}  ← ${item.reason}`);
  process.exit(1);
}
console.log("✔ i18n 泄漏扫描通过（已迁移文件无硬编码中文）");

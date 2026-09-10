#!/usr/bin/env node
// hook 护栏：跑样式与 i18n 扫描，不通过时按 hook 协议在 stdout 输出 block JSON。
// Claude Code 与 Codex 的输出协议一致（decision / reason），所以两边共用同一条命令，
// 避免各写一份 shell 实现后行为漂移；也不依赖 jq 等外部工具。
// 用法（在两种 hook 里都从仓库根执行）：
//   cd "$(git rev-parse --show-toplevel)" && node scripts/hook-checks.mjs
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CHECKS = ["check-style-leaks.mjs", "check-i18n-leaks.mjs"];

const failures = [];
for (const check of CHECKS) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(ROOT, "scripts", check)], {
    encoding: "utf8",
  });
  if (status !== 0) failures.push(`${stdout}${stderr}`.trim());
}

if (failures.length === 0) {
  console.log("✔ 样式与 i18n 护栏通过");
  process.exit(0);
}
process.stdout.write(JSON.stringify({ decision: "block", reason: failures.join("\n\n") }));

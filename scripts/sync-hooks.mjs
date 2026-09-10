#!/usr/bin/env node
// 安装 agent 侧的 hook（正本随仓库分发，本机副本可随时重建）：
//   .codex/claude-settings.json  → .claude/settings.json  （整体覆盖；.claude/ 被 gitignore，属本地物料）
//   scripts/git-hooks/pre-commit → .git/hooks/pre-commit  （整体覆盖 + chmod；.git/hooks 不进版本控制）
//   .codex/codex-hooks.json      → .codex/hooks.json      （按命令合并，保留他人 hook，如 graphify）
// 触发：pnpm install（postinstall）或手动 pnpm hooks:sync。
// 覆盖型目标是生成物：直接改它会在下次同步时被正本覆盖。个人配置请写 .claude/settings.local.json。
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 内容完全由正本决定的副本。 */
const COPIES = [
  {
    label: "Claude Code hook 配置",
    source: join(ROOT, ".codex", "claude-settings.json"),
    target: join(ROOT, ".claude", "settings.json"),
  },
  {
    label: "git pre-commit 检查",
    source: join(ROOT, "scripts", "git-hooks", "pre-commit"),
    target: join(ROOT, ".git", "hooks", "pre-commit"),
    executable: true,
  },
];

/** 本机文件可能已含他人 hook，只能替换「自己那条」，不能整体覆盖。 */
const MERGES = [
  {
    label: "Codex hook 配置",
    source: join(ROOT, ".codex", "codex-hooks.json"),
    target: join(ROOT, ".codex", "hooks.json"),
    /** 命令里含此串即视为本仓库装的这条。 */
    mark: "scripts/hook-checks.mjs",
  },
];

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** 把 incoming 的每个事件追加到 existing，先摘掉 existing 里带 mark 的旧条目。 */
function mergeHooks(existing, incoming, mark) {
  const merged = { ...existing, hooks: { ...(existing.hooks ?? {}) } };
  for (const [event, groups] of Object.entries(incoming.hooks ?? {})) {
    const kept = (merged.hooks[event] ?? []).filter(
      (group) => !(group.hooks ?? []).some((handler) => String(handler.command ?? "").includes(mark)),
    );
    merged.hooks[event] = [...kept, ...groups];
  }
  return merged;
}

let changed = 0;

for (const { label, source, target, executable } of COPIES) {
  if (!existsSync(source)) {
    console.error(`跳过 ${label}：找不到正本 ${source}`);
    continue;
  }
  // 目标目录不存在（例如只导出了源码目录）时静默跳过，不算失败
  if (!existsSync(dirname(target))) {
    console.log(`跳过 ${label}：目标目录不存在（${dirname(target)}）`);
    continue;
  }
  const wanted = readFileSync(source);
  const current = existsSync(target) ? readFileSync(target) : null;
  if (current?.equals(wanted)) {
    console.log(`· ${label} 已是最新`);
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, wanted);
  if (executable) chmodSync(target, 0o755);
  console.log(`✔ ${label} ${current ? "已用正本覆盖本机旧副本" : "已安装"}`);
  changed += 1;
}

for (const { label, source, target, mark } of MERGES) {
  if (!existsSync(source)) {
    console.error(`跳过 ${label}：找不到正本 ${source}`);
    continue;
  }
  if (!existsSync(dirname(target))) {
    console.log(`跳过 ${label}：目标目录不存在（${dirname(target)}）`);
    continue;
  }
  const incoming = readJson(source);
  const existing = readJson(target);
  const merged = mergeHooks(existing, incoming, mark);
  const wanted = serialize(merged);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === wanted) {
    console.log(`· ${label} 已是最新`);
    continue;
  }
  const keptOthers = Object.values(merged.hooks).flat().length - Object.values(incoming.hooks ?? {}).flat().length;
  writeFileSync(target, wanted);
  console.log(`✔ ${label} 已合并${keptOthers > 0 ? `（保留他人 hook ${keptOthers} 条）` : ""}`);
  changed += 1;
}

console.log(changed ? `✔ agent hook 同步完成（${changed} 项更新）` : "✔ agent hook 均已就绪");

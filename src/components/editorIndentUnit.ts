/**
 * 探测文档的缩进单位（VSCode 同款思路）：行首有 Tab 用 Tab，否则取前若干行非空缩进的最小空格数。
 * 参考线包按 getIndentUnit 画网格，单位必须和文件实际缩进一致，参考线才能对齐文字列。
 */
export function detectIndentUnit(doc: string): string {
  let usesTabs = false;
  let minSpaces = Infinity;
  for (const line of doc.split("\n", 200)) {
    const match = /^[ \t]+/.exec(line);
    if (!match || !line.slice(match[0].length).trim()) continue;
    if (match[0].includes("\t")) {
      usesTabs = true;
      break;
    }
    minSpaces = Math.min(minSpaces, match[0].length);
  }
  if (usesTabs) return "\t";
  return " ".repeat(Number.isFinite(minSpaces) ? minSpaces : 2);
}

/** 参考线网格平移量（ch）：包锚点在 (k-1)*单位+0.5ch，平移后参考线落在第 k 级文字列上。 */
export function indentGuideShiftCh(unit: string, tabSize = 4): number {
  return (unit.includes("\t") ? tabSize : unit.length) - 0.5;
}

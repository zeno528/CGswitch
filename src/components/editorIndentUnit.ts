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

export interface IndentGuideLayout {
  markEnds: number[];
  fillSegments: number[];
}

export function visualIndentColumns(text: string, tabSize = 4): number {
  let columns = 0;
  for (const char of text) columns += char === "\t" ? tabSize - (columns % tabSize) : 1;
  return columns;
}

/** Find indentation guide positions on whitespace spans instead of a repeating CSS gradient. */
export function indentGuideLayout(line: string, unit: string, tabSize = 4, inheritedGuideCount?: number): IndentGuideLayout {
  const prefix = /^[ \t]*/.exec(line)?.[0] ?? "";
  const unitColumns = visualIndentColumns(unit, tabSize);
  if (!unitColumns) return { markEnds: [], fillSegments: [] };

  const indentColumns = visualIndentColumns(prefix, tabSize);
  const guideCount = inheritedGuideCount ?? Math.max(0, Math.ceil(indentColumns / unitColumns) - 1);
  const markEnds: number[] = [];
  let column = 0;
  let nextGuide = 1;
  for (let index = 0; index < prefix.length; index += 1) {
    const char = prefix[index];
    column += char === "\t" ? tabSize - (column % tabSize) : 1;
    while (nextGuide <= guideCount && nextGuide * unitColumns <= column) {
      const boundary = nextGuide * unitColumns;
      if (boundary < indentColumns || (inheritedGuideCount !== undefined && boundary <= indentColumns)) {
        markEnds.push(index + 1);
      }
      nextGuide += 1;
    }
  }

  const fillSegments: number[] = [];
  column = indentColumns;
  while (nextGuide <= guideCount) {
    const boundary = nextGuide * unitColumns;
    fillSegments.push(boundary - column);
    column = boundary;
    nextGuide += 1;
  }
  return { markEnds, fillSegments };
}

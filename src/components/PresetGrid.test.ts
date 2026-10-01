// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PresetGrid.tsx", import.meta.url), "utf8");
// 类名断言只针对代码：先剥掉注释，免得注释里提到旧类名时误报
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("预设选择网格", () => {
  it("默认态不带描边，只有选中才是强调色", () => {
    expect(code).toContain('"shadow-[0_0_0_1px_var(--accent)] bg-(--active-bg)"');
    expect(code).toContain('"hover:bg-(--hover-bg)"');
    // 整格整排的中性描边是噪声：14 个格子时那一圈圈浅框比空出来的末行更抢眼
    expect(code).not.toContain("var(--panel-ring)");
  });

  it("不套卡片框：编辑正文无卡片外观，区块靠分隔线分区", () => {
    // apple-edit-surface 刻意不带底色/圆角/裁切；这里再多包一层带描边的容器
    // 只会把末行的空当圈起来，并多出一级包装深度
    expect(code).toContain('<div className="apple-panel-section">');
    expect(code).not.toContain("border-[var(--panel-border)]");
    expect(code).not.toMatch(/className="rounded-[^"]*border/);
  });

  it("列数随可用宽度自适应：复用 apple-tile-grid 全局类（机制定义在 style.css）", () => {
    expect(code).toContain("apple-tile-grid apple-tile-grid--labeled");
    // 断点阶梯禁令的全局唯一一份：sm:grid-cols-* 也含 grid-cols-，一条覆盖
    expect(code).not.toContain("grid-cols-");
  });

  it("供应商是按名字挑的，名称保持常显且可截断", () => {
    // 与图标页的图标主导形态相反：这里不能把名称换成 hover/选中才显示
    expect(code).toContain("<ProfileIconTile");
    expect(code).toContain('className="block truncate text-xs font-semibold tracking-tight"');
  });
});

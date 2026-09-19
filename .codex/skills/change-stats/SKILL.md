---
name: change-stats
description: 统计当前工作区相对 HEAD 的代码变更行数与文件分布，并默认排除性能基线产物（`reports/`、`.codex/skills/performance-baseline/reports/`）。用 `git diff HEAD --numstat` 取原始行数，在 PowerShell 里过滤掉报告路径后做加和、按目录归类。当用户说"我变更了多少行"、"统计改动"、"diff 行数"、"这次改了多少"、"变更多少行"时使用。
---

# 变更行数统计

给一个对当前工作区真实有用的"行数 + 文件分布"快照，默认不把性能基线报告算进来。

## 排除范围（默认）

| 路径 | 理由 |
|---|---|
| `reports/**` | 性能基线产物（Criterion 输出、release 资源、生产构建产物等） |
| `.codex/skills/performance-baseline/reports/**` | 同上的 skill 自留产物 |

每次跑必须先列出"被排除的路径与行数"，让用户能交叉验证 —— 不静默丢弃。

## 工作流

### Step 1：取原始 numstat

先跑 `git diff HEAD --numstat`（不要 `--cached`，工作区里既有已暂存也有未暂存改动，统一看 HEAD 才是真实"自上次提交以来改了多少"）。如果用户明确说"只看已暂存"，再换成 `git diff --cached --numstat`，并在报告里写明口径。

### Step 2：分离报告 vs 业务

按"包含 `reports/`"前缀过滤出两类：

- **业务 diff**（要算的）：剩余行
- **报告 diff**（要列出来但不计入合计）：被过滤的行

报告类一律只列"文件 + +N"，不展开 diff。

### Step 3：聚合

PowerShell 一行搞定加和：

```powershell
$rows = git diff HEAD --numstat | Where-Object { $_ -notmatch 'reports[\\/]' }
$add  = ($rows | ForEach-Object { [int]($_ -split "`t")[0] } | Measure-Object -Sum).Sum
$del  = ($rows | ForEach-Object { [int]($_ -split "`t")[1] } | Measure-Object -Sum).Sum
Write-Host ("合计: +{0} -{1} (共 {2} 行净变化)" -f $add, $del, ($add + $del))
```

注意是 `+{add} -{del}`，不要写成 `+{add -del}`。

### Step 4：按目录归类

把剩余行按父目录分桶，每桶只列一行小计，方便用户一眼看出"主要动的是哪一块"。分桶规则：

| 桶 | 路径前缀 |
|---|---|
| Rust 后端 | `src-tauri/src/` |
| 前端组件 | `src/components/` `src/features/` |
| 前端应用层 | `src/app/` `src/api/` |
| 文案 / 样式 | `src/i18n/` `src/style.css` |
| Scripts / CI | `scripts/` `.github/` |
| Skill 自身 | `.codex/skills/change-stats/` |
| 其他 | 上述未覆盖 |

桶内文件按 `git diff HEAD --numstat` 原始顺序排，**不要**按行数排 —— 保留 working tree 的真实变动顺序对调试更有用。

## 输出格式

**必须**按以下顺序输出，不要自由发挥：

1. **口径声明**：HEAD vs 工作区，还是 staged-only；是否含未跟踪文件（默认不含，要含时显式说明）。
2. **合计表格**（含/不含报告两栏对照）：

    | 指标 | 不含报告 | 含报告 |
    |---|---|---|
    | 新增 | +N | +N |
    | 删除 | −N | −N |
    | 净变化 | ±N | ±N |
    | 总 churn | N | N |
    | 文件数 | N | N |

3. **按目录分布表**：桶 / 文件数 / `+/−`。
4. **逐文件清单**：精简表格，`+ / − / 文件`，只列业务文件，报告类单列在末尾并标注"已扣除"。
5. **备注**：只写真正有信号的观察，例如"`plugins/mod.rs` 的 −841 几乎全部迁移到同目录 5 个新文件，是纯文件级拆分"。不要为了凑段尾写口水话。

## 边界

- 不要用 `git diff --shortstat` 之类聚合命令拿数据 —— 拿不到逐文件明细，按目录分桶就做不了。
- 不要把未跟踪文件（`??`）算进去，除非用户明确要求"含新文件"。新文件的真实影响应通过别的流程（commit message、PR description）表达。
- 不要展开 diff 内容，只数行数。
- 不要把"暂存"和"未暂存"分开报，除非用户问 —— 合并看 HEAD 才是真实工作量。
- 性能报告被排除时**必须**在报告里点名具体文件名和行数，让用户能交叉验证没算错。

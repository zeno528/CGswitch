---
name: performance-baseline
description: Measure and retain CGswitch performance baselines for Criterion Rust hot paths, production frontend builds, and explicitly scoped desktop or browser timings. Use for recurring performance tests, regressions, baseline comparisons, and preserving measured results; do not use for implementing optimizations or general code review.
---

# CGswitch 性能基线

用本 Skill 做可重复的测量与对比；不在此过程中修改业务代码。

## 流程

1. 记录 `git rev-parse --short HEAD`、`git status --short`、`node --version`、`pnpm --version`、`cargo --version` 与 `rustc --version`。
2. 为本次创建唯一标签后，分别运行：

```powershell
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
cargo bench --bench config_bench --manifest-path src-tauri/Cargo.toml -- --save-baseline "perf-$stamp"
```

```powershell
pnpm build
```

3. 从 `src-tauri/target/criterion/*/new/estimates.json` 读取 Criterion 均值和 95% 区间，复制到新的 `reports/baselines/<stamp>.md`，并在 `reports/history.md` 追加一行索引。不要覆盖旧记录。
4. 只有用户明确要求桌面或浏览器体验测量时，按 [测量约定](references/measurement-contract.md) 追加结果；必须注明 `release-native`、`dev-web` 或 `web-mock`。
5. 比较只限相同基准名、同一命令和可比环境。将差异写成「需复测」或「回归/改善」，不要把不同机器、Mock 或调试构建混为一谈。

## 输出

- 一份带环境、命令、原始指标和限制条件的日期报告。
- `reports/history.md` 的可追溯索引与上一次可比记录的结论。
- Criterion HTML 仅作本机细节查看；长期比较以 `reports/` 的已跟踪 Markdown 为准。

## 边界

- 不自动执行 `pnpm tauri build`、停止正在运行的 App 或 `cargo clean`。
- 不因 Vite 的包体警告直接改代码；先拿到可比的真实测量。
- 不把 `web-mock` 时间称为 Tauri 原生冷启动时间。

详见 [测量约定](references/measurement-contract.md)、[历史索引](reports/history.md)、[输出风险](reports/output-risk-profile.md) 与 [触发用例](evals/trigger_cases.json)。

---
name: performance-baseline
description: Measure and retain CGswitch performance baselines, centred on what a user can actually perceive — cold start, tray restore, resident memory and idle CPU, install size — plus Criterion Rust hot paths and production frontend builds. Use for recurring performance tests, regressions, baseline comparisons, and preserving measured results; do not use for implementing optimizations or general code review.
---

# CGswitch 性能基线

用本 Skill 做可重复的测量与对比；不在此过程中修改业务代码。

## 产出标准：用户可感知

**只有用户在界面上能直接感知的，才算本 Skill 的产出。** 内部指标（函数耗时、包体字节）只有在能解释某个可感知现象时才有意义 —— 否则不作结论。

对照下表，**能测的必须测**，测不了的必须写明「缺什么才能测」，不能默默跳过。

| # | 维度 | 用户场景 | 终点定义 | 采集方式 | 状态 |
|---|---|---|---|---|---|
| 1 | **冷启动** | 双击图标从零打开 | 主窗口可见且进程可响应 | `scripts/perf-probe.ps1` | 自动 |
| 2 | **托盘恢复** | 关掉窗口后再点图标 | 主窗口重新可见 | 同上 | 自动 |
| 3 | **安装体积** | 下载、占盘 | 安装目录 / 安装包 MB | 同上 | 自动 |
| 4 | **常驻资源** | 托盘挂机数小时~数日 | 私有内存与句柄是否单调增长；空闲 CPU 占用 | 同上（`-SoakSeconds`） | 自动 |
| 5 | **首屏内容就绪** | 窗口出现后多久能看到供应商列表 | 列表可读（非骨架屏） | **需埋点或 WebView2 自动化** | 缺 |
| 6 | **页面切换** | 点侧边栏 5 个入口 | 目标视图可交互 | 同上 | 缺 |
| 7 | **等待类操作** | 应用配置 / 测试连通 / 获取模型 / 市场加载 | spinner 消失 | 同上 | 缺 |

维度 5–7 属**已知未覆盖**，不得用 `web-mock` 或 dev 构建的数据冒充；每次出报告都要在「尚未覆盖」里重新点名。

## 流程

1. 记录 `git rev-parse --short HEAD`、`git status --short`、`node --version`、`pnpm --version`、`cargo --version` 与 `rustc --version`。
2. **确认没有同实例在跑**（App 注册了 single-instance，已有实例时再启动走「聚焦已有窗口」路径，不是冷启动）。不得自行结束用户的实例。
3. 确认被测产物是 `tauri build` 的产品（见「可测产物」）。跑用户可感知探针：

```powershell
pwsh -File scripts/perf-probe.ps1 -Exe "<安装目录>\cgswitch.exe" -Runs 3 -SoakSeconds 600
```

4. 若本轮涉及 Rust 或前端改动，追加支撑层测量：

```powershell
cargo bench --bench config_bench --manifest-path src-tauri/Cargo.toml -- --save-baseline "perf-$(Get-Date -Format 'yyyy-MM-dd-HHmm')"
```

```powershell
pnpm build
```

5. 新建 `reports/baselines/<stamp>.md` 写本次结果（探针输出 + 支撑层数据 + 环境 + 可比性说明），并在 `reports/history.md` 追加一行索引。**不要覆盖旧记录。**
6. 比较只限相同基准名、同一命令和可比环境。差异写成「回归 / 改善 / 环境噪声」，不同机器、Mock 或调试构建不得混为一谈。**环境无法对齐时，宁可写「不可归因」。**

## 输出

- 一份带环境、命令、原始指标和限制条件的日期报告。
- `reports/history.md` 的可追溯索引与上一次可比记录的结论。
- Criterion HTML 仅作本机细节查看；长期比较以 `reports/` 的已跟踪 Markdown 为准。

## 可测产物（关键）

只用 **`tauri build` 的产物**：安装目录里的 exe，或同一次构建产出的 `src-tauri/target/release/cgswitch.exe`。

**不要拿 `cargo build` / `cargo bench` 直接编出的 `target/release/*.exe` 测**：它们缺少 `custom-protocol` 特性、前端资源未嵌入，实测**主窗口永不显示** —— 会被误读成「窗口显示回归」。判别方法：`cargo bench` 会刷新该文件时间戳但不产生 `src-tauri/target/release/bundle/`。

## 边界

- 不自动执行 `pnpm tauri build`（耗时且会产出安装包；需要绑定 HEAD 的产物时，先向用户要一次构建产物或取得明确同意）。用户已明确授权构建时不受此限。
- 不自动停止正在运行的 App —— 包括用户的 dev 会话。
- 不因 Vite 的包体警告直接改代码；先拿到可比的真实测量。
- 不把 `web-mock`、`dev-web` 或调试构建的时间称为 Release 原生数据。

详见 [测量约定](references/measurement-contract.md)、[历史索引](reports/history.md)、[输出风险](reports/output-risk-profile.md) 与 [触发用例](evals/trigger_cases.json)。

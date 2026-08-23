# 测量约定

## 可比性

- Rust 微基准固定使用 `src-tauri/benches/config_bench.rs`，其临时目录不会触碰真实 `~/.cgswitch` 或 `~/.codex`。
- 每次保存新的 Criterion 标签，读取本次 `new/estimates.json`；旧标签只用于 Criterion 图表内部比较。
- 记录 Git 提交、工作区是否干净、Node/pnpm/Cargo/Rust 版本。硬件、供电模式或防病毒负载不同则标为环境变化。

## 体验测量

- `release-native`：先确认没有同实例运行，计时终点必须是窗口可见且可交互；记录至少三次冷启动。仅进程存在或端口监听不算启动完成。
- `dev-web`：可用于页面加载和交互趋势，但不能代替 Release 桌面数据。
- `web-mock`：可验证前端状态流和相对变化，不代表 IPC、文件系统扫描或外部 Codex CLI 的耗时。

## 判读

- Criterion 的 95% 区间跨过零或仅出现极小差异时，写「噪声范围内」。
- `settings_write` 方差较大时，按 Criterion 提示增加测量时间后再判定回归。
- Vite 的 `>500 kB` 只提示拆包机会；需要结合真实首屏或交互数据后才能优化。

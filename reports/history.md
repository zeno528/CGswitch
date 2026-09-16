# 性能基线索引

| 日期 | 报告 | HEAD | 分支 | 冷启动中位 | 托盘恢复中位 | 备注 |
|---|---|---|---|---|---|---|
| 2026-09-16 21:29 | [baselines/2026-09-16-2129.md](baselines/2026-09-16-2129.md) | `096dd85` | codex/minor-fixes | 744 ms | 316 ms | 首份基线；bundle 较 main +44 KB；常驻 10 min 无泄漏；Criterion baseline `perf-2026-09-16-2129` |
| 2026-09-16 22:18 | [baselines/2026-09-16-2218-lazysplit-ab.md](baselines/2026-09-16-2218-lazysplit-ab.md) | `096dd85` | codex/minor-fixes | 722 ms（前）/ 714 ms（后），n=7 双侧 | 306 / 304 ms | A/B 负结果：视图 lazy 拆分使首屏 JS −26%，但冷启动无可测差异（<15 ms，被噪声淹没）；WebView2 初始化才是瓶颈 |

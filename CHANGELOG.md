# CHANGELOG

## [0.6.0] - 2026-08-23

### 新增

- 插件市场正式启用：支持官方与第三方 GitHub 源，可浏览、预览、安装、卸载、启用 / 停用插件
- 第三方市场插件支持「检查更新」与「一键全部升级」
- 新增「Skill」浏览视图，集中展示 Codex 自动发现的所有 Skill

### 界面与样式

- 插件市场顶部加入「检查更新 / 全部升级」操作区；添加市场与仓库安装合并到统一入口
- 卸载市场、滚动位置缓存、加载骨架等细节收敛到统一插件市场视图

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.6.0-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.6.0-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.6.0-macOS-x64.dmg`

## [0.5.4] - 2026-08-23

### 新增

- 设置页"高级"分区改为可折叠面板，备份操作与备份记录分节管理
- 供应商配置新增"遵循系统代理"开关，开启后 Codex 的网络请求走操作系统代理，重启 Codex 后生效
- MCP 配置段自动收拢，去除显式根表 `[mcp_servers]` 的冗余噪声

### 修复

- MCP 同步对话框的方向与覆盖范围描述逻辑修正，避免歧义
- 重启 Codex 时进度卡片切换不再卡顿（动画改为纯 CSS，与列表拖动不再争抢主线程）
- 首页与 MCP 页首卡片间距双重叠算回归全局定义，间距统一
- 供应商卡片与拖拽预览的垂直对齐偏移修正
- 编辑页"1M 上下文窗口"开关与新增"遵循系统代理"开关对齐

### 界面与样式

- 供应商卡片的认证来源图标统一
- 样式 token 化硬编码色值，清理迁移遗留的重复定义
- 样式泄漏扫描纳入 `pnpm check` 流水线，新增样式必须走全局类 / token

### 重构

- 设置页拆分为"通用 / 应用 / 账号 / 高级 / 关于"五个分区组件，按需加载
- AppShell 状态与交互按职责拆分为独立 hooks
- McpSyncDialog 步骤结构与选择项布局重构

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.5.4-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.5.4-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.5.4-macOS-x64.dmg`

## [0.5.2] - 2026-08-22

### 新增

- 供应商列表支持拖拽重排序，拖拽时显示卡片预览

### 修复

- AlertDialog 关闭后自动失去焦点，避免焦点残留
- 删除/复制供应商的交互体验优化
- 余额/用量查询按钮不再被强制禁用，可随时刷新
- 移除预设中的示例 API 基础 URL，避免误用

### 界面与样式

- 图标库由 phosphor 切换为 lucide-react
- 编辑页控件与对话框交互优化
- 编辑页交互全面增强
- toast 按 tone 区分图标与样式
- AppSwitch 组件的交互、样式与可访问性优化
- 认证信息处理逻辑统一，配置更可靠

### 重构

- 前端从 Vue 3 迁移至 React 19，并按 profiles / mcp / settings 等领域模块化

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.5.2-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.5.2-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.5.2-macOS-x64.dmg`

## [0.5.0] - 2026-08-21

### 新增

- MCP 编辑页实时同步：表单与 TOML 片段双向更新

### 修复

- DeepSeek 模型配置调整，禁用搜索工具支持

### 界面与样式

- 优化按钮样式，增强错误提示的可视化效果

### 重构

- 后端 `services.rs`（4448 行单体）拆分为 9 个聚焦模块：`accounts` / `apply` / `connections` / `mcp` / `profile_config` / `profiles` / `settings` / `storage` + `mod.rs`
- 前端 `ProfileEdit.vue` 拆分为 `ProfileEditDocuments` / `ProfileEditProviderSection` 子组件与 `profileEditText` 工具函数；`McpEdit` / `McpView` 同步适配
- 移除 `motion-v` 动画库并优化视图切换效果

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.5.0-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.5.0-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.5.0-macOS-x64.dmg`

## [0.4.13] - 2026-08-21

### 新增

- Codex 托管条目管理，用户配置与自动管理条目分离

### 修复

- MCP 配置相关提示信息，确保数据库与 config.toml 关系清晰

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.4.13-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.4.13-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.4.13-macOS-x64.dmg`

## [0.4.8] - 2026-08-20

### 新增

- 添加认证状态管理，多个组件可获取并展示认证状态
- 新增数据库备份数量设置，支持自定义保留份数
- 落实 MCP 镜像同步规则

### 界面与样式

- 优化 MCP 同步对话框的差异展示与交互体验
- 优化多个组件的布局与样式
- 调整配置编辑器文件标签顺序，将模型目录文件放在第二位

### 修复

- 启动时不再显示多余的“未认证”账号胶囊，避免认证状态加载时出现颜色闪烁

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.4.8-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.4.8-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.4.8-macOS-x64.dmg`

## [0.4.4] - 2026-08-20

### 新增

- 新增 MCP 服务器管理页，全局生效，切换供应商自动携带配置
- MCP 配置落库镜像，随数据库备份/恢复一起携带，创建表单自动预填全局 MCP 段
- MCP 防崩守卫：配置文件异常时自动恢复，支持配置 ↔ 数据库显式双向同步
- MCP 同步差异预览与双向同步对话框，改动前先看差异
- 新增数据库导出功能，支持自定义导出目录及自动备份设置
- 编辑器新增 TOML / JSON 格式校验，创建档案时支持连通性测试

### 修复

- 更新数据库备份命名规则，兼容新旧前缀

### 界面与样式

- 统一各页标题栏高度，操作按钮跨页对齐到同一水平线
- 统一编辑页工具栏样式，优化内容区滚动与间距
- 统一窗口标题栏高度与内容区布局、圆角样式
- 更新路径信息和备份目录标签文案

### 重构

- 引入 AppSwitch 组件替换 n-switch，优化设置界面交互

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.4.4-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.4.4-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.4.4-macOS-x64.dmg`

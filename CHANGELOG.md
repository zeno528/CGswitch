# CHANGELOG

## [0.10.0] - 2026-09-03

### 界面与样式
- macOS 窗口启用原生交通灯标题栏，主界面调整为一体化工作区布局，侧边栏与内容区的层级更清晰
- macOS DMG 安装窗口新增拖拽引导：将 CGswitch 拖入 Applications 文件夹即可完成安装

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.10.0-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.10.0-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.10.0-macOS-x64.dmg`

## [0.9.0] - 2026-08-27

### 新增
- 新增 OpenRouter 内置供应商：开箱即用的 Responses API 接入，无状态存储配置，支持在线获取模型列表
- 新增小米 MiMo 内置供应商：内置 mimo-v2.5-pro / mimo-v2.5 官方模型目录，按官方要求禁用联网搜索
- 供应商编辑页新增「获取模型列表」：OpenAI 兼容 /models 端点拉取可用模型，多候选端点自动回退，错误信息自动脱敏 API Key
- 新建自定义供应商支持第三个槽位 auth.json：config.toml / models.json / auth.json 选填，填了才入库
- 自定义配置模板与 cc-switch 对齐：不再预填占位内容，模型输入框留空待选

### 变更
- 内置供应商 config.toml 模板统一改为后端单一来源，前端仅保留展示元数据，消除双份维护

### 修复
- 修复第三方档案被误判为带认证的问题

### 界面与样式
- 下拉选择器优化：菜单翻转按实际展示高度判定，背景滚动时自动收起，滚轮不穿透背景

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.9.0-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.9.0-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.9.0-macOS-x64.dmg`

## [0.8.3] - 2026-08-25

### 新增
- 智谱供应商新增 5 小时 / 7 天用量窗口展示，与余额查询通道分离，用量类供应商统一展示「用量」文案
- ChatGPT 订阅额度进度条刷新时从旧值平滑过渡到新值，遵循系统动画偏好设置

### 修复
- 余额 / 用量查询失败时统一展示「查询失败」，不再继续显示可能误导的旧数据
- 第三方供应商缺少 API Key 时不再发出无效请求，直接在卡片提示

### 界面与样式
- 供应商卡片拖拽体验优化：拖起时跟手提升，悬停 / 激活态改用清晰的描边样式，拖动期间被拖卡片隐藏并保留布局占位

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.8.3-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.8.3-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.8.3-macOS-x64.dmg`

## [0.8.2] - 2026-08-25

### 新增
- 智谱 GLM 用量查询：新增 5 小时 / 7 天双窗口展示，与余额查询通道分离

### 修复
- 余额 / 用量查询失败时统一展示「查询失败」，不再继续显示可能误导的旧数据
- 第三方供应商缺少 API Key 时不再发出无效请求，直接在卡片提示

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.8.2-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.8.2-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.8.2-macOS-x64.dmg`

## [0.8.1] - 2026-08-25

### 修复
- 官方订阅档案切换前吸收 Codex 运行中产生的同账号 OAuth auth.json，避免被异步 token 刷新覆盖较新的切换
- OAuth token 读取与刷新改为同一账号串行化，杜绝并发刷新导致的凭据错乱
- 解析官方 auth.json 时同步提取 refresh_token / id_token，激活 OAuth 配置必须经 refresh_token 重新验证，不再直接复用旧缓存
- 桌面端认证清空语义调整：清空 auth 视为移除旧快照等待下次桌面认证，遗留空快照会在下次 focus refresh 时被重新填充
- 切换按钮文案统一为「切换 / 使用中」，切换成功提示追加「重启Codex生效」以反映自动重启流程

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.8.1-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.8.1-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.8.1-macOS-x64.dmg`

## [0.8.0] - 2026-08-25

### 新增
- 区分桌面端登录（Codex CLI 自带）与 OAuth 订阅登录两种认证方式，新建官方配置时可二选一
- 档案编辑器新增「+ 添加或管理 ChatGPT 账号」入口，跳转设置页统一管理订阅账号
- 设置页新增 ChatGPT 官方额度查询与显示
- 新增 OpenCode Go 提供商支持（含鉴权探针式连通性测试）
- 档案后端区分官方与第三方类型，为后续配置策略提供明确的归属

### 修复
- 官方订阅档案切换时不再被异步 OAuth token 刷新覆盖，杜绝配置切换与凭据刷新之间的竞态
- 供应商卡片激活态的描边、悬停残留、拖拽预览等视觉表现统一收敛
- Codex 状态徽标的桌面端 / OAuth 来源视觉与可达性修复
- 捕获供应商不再自动设为使用中，激活状态仅由手动应用建立
- 各页面折叠面板统一为 AppDisclosure 组件，展开 / 折叠行为一致

### 界面与样式
- 移除重启进度卡片，恢复简洁的交互反馈

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.8.0-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.8.0-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.8.0-macOS-x64.dmg`

## [0.7.4] - 2026-08-24

### 修复

- 官方订阅档案 live auth 同步支持手动接管：在供应商编辑器修改 auth 字段后自动标记为手动接管，避免被 Codex 轮换的最新凭据覆盖
- 同步时校验账号一致性：live auth 的 account_id 与档案不匹配时拒绝写回，防止不同账号之间的凭据交叉覆盖
- 窗口聚焦 / 启动 CGswitch 时也会拉取最新 live auth 写回活动档案，及时捕获窗口外的凭据轮换
- raw_auth 与 live 内容一致且已处于自动同步状态时跳过写库，减少无意义写盘

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.7.4-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.7.4-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.7.4-macOS-x64.dmg`

## [0.7.2] - 2026-08-24

### 修复

- 供应商编辑器清空 `auth` 字段后，会同步删除活动 live `auth.json`（删除前自动备份到 `codex_files_backup`），避免残留凭据与编辑器状态不一致

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.7.2-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.7.2-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.7.2-macOS-x64.dmg`

## [0.7.1] - 2026-08-24

### 新增

- 本地 Skill 管理：扫描家目录未托管 Skill，按同名冲突 / 已托管更新分类展示，支持预览 SKILL.md 后一键导入
- 导入流程在覆盖前自动备份原文件，避免目录被破坏；可手动删除本地 Skill（含回退备份）
- Skills 视图重构为列表 + 详情 + 导入向导三段式，支持 markdown 预览与目录去重
- 插件市场与 Skill 视图共享 `managementDataCache`，跨视图缓存复用，进入页面无需重新请求

### 修复

- 写回 `config.toml` 时统一收拢 `[marketplaces.*]` → `[plugins.*]` → `[hooks.*]` 的连续顺序：所有 CGswitch 写入路径（MCP 增删改、镜像写回）以及 Codex CLI 直写（插件安装 / 升级 / 市场增删）后都会规范化；未变化则不落盘
- MCP 列表接入共享缓存，增删改与同步差异后强制刷新，避免本地状态与数据库短暂不一致

### 界面与样式

- 新增 `EmptyStateCard` 组件统一空 / 加载占位
- 第三方市场文案统一为「外部市场」，插件来源注释同步更新

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.7.1-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.7.1-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.7.1-macOS-x64.dmg`

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

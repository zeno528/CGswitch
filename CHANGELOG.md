# CHANGELOG

## [0.13.2] - 2026-09-06

### 新增
- 插件管理自动识别系统代理：配置了系统代理但未在终端 export 的用户，添加 / 更新插件市场不再因 git 不读取系统代理而失败（支持 macOS scutil 与 Windows 注册表代理设置）。

### 修复
- 修复插件管理 CLI 在网络异常时长时间无响应的问题：新增分档超时保护（本地操作 20 秒、联网操作 60 秒），超时快速失败并提示，不再卡住界面。
- 修复 DeepSeek 等供应商返回多币种余额时只取第一项、且混入零余额币种的问题：过滤零余额币种并同时展示全部非零余额币种。
- 修复内置供应商创建页的 config.toml 预览与实际配置不一致的问题：预览改用 render_config 真实渲染，minimax 等依赖 model_catalog_json 的模型目录不再缺失。

### 界面与样式
- 插件市场「推荐市场」区固定展示全部官方推荐市场：已添加的市场标注「已安装」并可点击「浏览插件」直接进入，不再隐藏或与下方已添加列表重复；市场按别名识别，适配不同渠道下官方市场名称的差异。
- 插件市场浏览列表中插件卡片描述改为单行截断，超长不再撑开卡片布局。
- 插件市场视图样式微调（已安装数量徽标改为强调色等）。

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.13.2-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.13.2-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.13.2-macOS-x64.dmg`

### macOS 首次打开

首次打开 macOS 版本时，如果系统阻止打开应用，请先将应用拖入「应用程序」，再前往「系统设置 → 隐私与安全性」，允许打开该应用。如果仍无法打开，再在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

然后再次打开 CGswitch；如果安装到了其他目录，请将命令中的路径替换为实际的 `.app` 路径。

## [0.13.0] - 2026-09-06

### 新增
- 更新检查与升级流程区分侧边栏和关于页来源，避免更新提示出现在不相关位置。

### 修复
- 修复 Windows 与 macOS 的应用内更新下载安装与重启流程。
- 修复安装失败后仍残留「更新成功」标记的问题。
- 修复更新提示卡片固定后点击外部无法收起的问题。

### 界面与样式
- 更新提示默认保持透明，悬停时显示高亮。
- 更新弹层改为按内容自适应宽度，减少右侧空白。
- 修复升级中文案变宽导致操作按钮布局异常的问题。

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.13.0-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.13.0-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.13.0-macOS-x64.dmg`

### macOS 首次打开

首次打开 macOS 版本时，如果系统阻止打开应用，请先将应用拖入「应用程序」，再前往「系统设置 → 隐私与安全性」，允许打开该应用。如果仍无法打开，再在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

然后再次打开 CGswitch；如果安装到了其他目录，请将命令中的路径替换为实际的 `.app` 路径。

## [0.12.5] - 2026-09-06

### 新增
- 应用内更新升级并重启后，会弹出「已更新到 vX.Y.Z」提示，仅显示一次

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.12.5-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.12.5-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.12.5-macOS-x64.dmg`

### macOS 首次打开

提示「"CGswitch" 已损坏，无法打开」时，终端执行（路径换成你的实际安装位置）：

```bash
xattr -cr /Applications/CGswitch.app
```

## [0.12.3] - 2026-09-06

### 修复
- 修复更新悬浮卡片在点击「立即升级」后布局变形的问题：升级中按钮文案变宽不再挤压按钮，空间不足时自动换行
- 修复供应商编辑页「压缩阈值」输入框数字垂直不居中的问题

### 界面与样式
- 导入 Skill 页「全选」按钮从顶部工具栏移至底部操作栏，与「取消 / 导入」并排

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.12.3-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.12.3-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.12.3-macOS-x64.dmg`

### macOS 首次打开

首次打开如果提示「"CGswitch" 已损坏，无法打开」，不是软件损坏。将应用拖入「应用程序」后，在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

然后再次打开 CGswitch；如果安装到了其他目录，请将命令中的路径替换为实际的 `.app` 路径。

## [0.12.1] - 2026-09-06

### 新增
- 新增启动时自动检查更新，可在通用设置中关闭
- 侧边栏新增更新横幅：发现新版本时出现，悬停或点击展开卡片，展示完整版本号并提供「更新日志」与「立即升级」入口
- 设置页「发现新版本」卡片新增「更新日志」按钮，可直接查看 GitHub Release 说明

### 界面与样式
- 关于页「数据与路径」顺序调整：Codex 配置移至最后

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.12.1-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.12.1-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.12.1-macOS-x64.dmg`

### macOS 首次打开

首次打开如果提示「"CGswitch" 已损坏，无法打开」，不是软件损坏。将应用拖入「应用程序」后，在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

然后再次打开 CGswitch；如果安装到了其他目录，请将命令中的路径替换为实际的 `.app` 路径。

## [0.11.5] - 2026-09-06

### 修复
- 修复新建/编辑供应商页「登录方式」下拉框内容在 macOS 上垂直不居中的问题
- 修复 macOS 上路径、代码等等宽文本回退到 Courier 字体显示突兀的问题，现统一使用系统原生等宽字体

### 界面与样式
- 关于页「数据与路径」改为紧凑分组列表：整行点击即可打开目录，路径自动缩写、悬停查看完整路径
- 新建供应商的「选择供应商」卡片更紧凑，图标与内边距同步缩小
- 压缩阈值输入框移除多余的「Token」文案

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.11.5-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.11.5-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.11.5-macOS-x64.dmg`

### macOS 首次打开

首次打开如果提示「"CGswitch" 已损坏，无法打开」，不是软件损坏。将应用拖入「应用程序」后，在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

然后再次打开 CGswitch；如果安装到了其他目录，请将命令中的路径替换为实际的 `.app` 路径。

## [0.11.4] - 2026-09-06

### 新增
- 编辑页新增「上下文管理」开关：一键启用 Codex 实验模式，关闭即移除该配置，且不影响配置文件中的其他 features 项

### 修复
- 修复 macOS 应用内更新下载安装完成后不会自动重启的问题，现在安装完成后自动重启进入新版本
- 修复 macOS 静默启动时窗口仍会闪现的问题
- 「检查更新」发现新版本后自动下载并安装，不再需要手动点击「升级」；同时取消进入设置页时的自动检查，改为仅手动触发

### 界面与样式
- 设置页高级分区的备份选项默认展开
- 关于页布局调整：GitHub 与「检查更新」改为紧凑按钮排布

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.11.4-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.11.4-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.11.4-macOS-x64.dmg`

### macOS 首次打开

首次打开如果提示「"CGswitch" 已损坏，无法打开」，不是软件损坏。将应用拖入「应用程序」后，在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

然后再次打开 CGswitch；如果安装到了其他目录，请将命令中的路径替换为实际的 `.app` 路径。

## [0.11.3] - 2026-09-06

### 新增
- ChatGPT 长上下文的压缩阈值支持自定义：原先固定 900000 Token，现可在编辑页输入 1–1,000,000 之间的数值，修改时配置文本实时同步更新
- 内置智谱模型目录新增 glm-5.3-flash（1M 上下文，支持文本 + 图片输入，low/high/max 三档推理）

### 修复
- 修复窗口较矮时下拉菜单向上弹出会被页面标题栏遮挡、选项无法点选的问题
- 修复编辑页顶部工具栏浮在对话框遮罩之上、弹窗打开期间仍可点击的问题
- 修复设置页切换分区后内容未正确刷新的问题
- 修复组件重复挂载时「检查更新」可能重复弹出通知的问题

### 界面与样式
- 「1M 上下文窗口」开关与压缩阈值输入框合并为一体化组合控件，开关行高度统一
- 编辑页底部操作栏按钮边框与背景微调

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.11.3-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.11.3-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.11.3-macOS-x64.dmg`

### macOS 首次打开

首次打开如果提示「"CGswitch" 已损坏，无法打开」，不是软件损坏。将应用拖入「应用程序」后，在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

然后再次打开 CGswitch；如果安装到了其他目录，请将命令中的路径替换为实际的 `.app` 路径。

## [0.11.0] - 2026-09-05

### 新增
- 应用内更新：设置页新增「检查更新」入口，启动时自动检查新版本，可直接下载并安装更新，无需手动下载安装包

### 修复
- 修复更新活动配置时丢失 computer-use 服务器配置的问题
- 修复 macOS 下主窗口隐藏后点击 Dock 图标无法重新唤起窗口的问题

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.11.0-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.11.0-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.11.0-macOS-x64.dmg`

### macOS 首次打开

首次打开如果提示「"CGswitch" 已损坏，无法打开」，不是软件损坏。将应用拖入「应用程序」后，在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

然后再次打开 CGswitch；如果安装到了其他目录，请将命令中的路径替换为实际的 `.app` 路径。

## [0.10.4] - 2026-09-04

### 新增
- 快照管理支持移除 Codex 管理的 MCP，外部 MCP 变更会自动同步到快照
- 技能视图新增可用技能计数展示

### 界面与样式
- 页面切换新增进入动画，切换更顺滑
- 侧边栏选中指示条在设置页不再显示
- 主视图卡片左边距归零，内容区滚动条槽右侧间距微调

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.10.4-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.10.4-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.10.4-macOS-x64.dmg`

## [0.10.1] - 2026-09-04

### 新增
- ChatGPT 多账号共存：同 workspace 登录不同账号不再互相覆盖，账号判重与认证快照归属改为双重身份匹配，存量账号自动迁移、无需重新登录
- 供应商模型列表缓存：编辑页成功拉取过的模型列表保存入库，再次打开不再重复请求供应商接口

### 修复
- 修复 Codex 运行中点击「重启」后无法再次启动的问题：macOS 强制结束进程后系统 LaunchServices 状态短暂滞后，`open` 激活旧实例失败且错误被吞掉，现改为读取 `open` 真实退出码并在失败时强制拉起新实例兜底

### 界面与样式
- 窗口标题栏高度收紧，主视图卡片上边距减小，顶部区域更紧凑
- 页面通知条位置调整为与顶部操作按钮水平对齐
- CodeMirror 行号列宽自适应，行数增多后不再显示不全

### 如何选择安装包

**Windows**：默认下载 `CGswitch-v0.10.1-Windows-setup.exe`，双击安装即可。需要批量部署、静默安装等场景可选用 `.msi` 版本。

**macOS**：
- Apple 芯片（M 系列）→ `CGswitch-v0.10.1-macOS-arm64.dmg`
- Intel 芯片 → `CGswitch-v0.10.1-macOS-x64.dmg`

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

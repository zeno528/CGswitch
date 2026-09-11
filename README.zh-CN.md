<p align="center">
  <img src="src-tauri/icons/icon.svg" width="112" alt="CGswitch logo" />
</p>

<h1 align="center">CGswitch</h1>

<p align="center">
  面向 Codex 供应商、账号、MCP 服务器、插件和 Skill 的本地优先桌面管理工具。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="https://github.com/zeno528/CGswitch/releases/latest">最新发行版</a> ·
  <a href="CHANGELOG.md">更新日志</a> ·
  <a href="https://github.com/zeno528/CGswitch/issues">问题反馈</a>
</p>

<p align="center">
  <a href="https://github.com/zeno528/CGswitch/releases/latest"><img src="https://img.shields.io/github/v/release/zeno528/CGswitch?display_name=tag&sort=semver&style=flat-square" alt="最新发行版" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-555?style=flat-square" alt="Windows 和 macOS" />
</p>

CGswitch 是一个 Tauri 桌面应用，用于管理 Codex 生态中的配置。它把供应商配置、ChatGPT 订阅账号、MCP 服务器、Codex 插件和 Skill 变成可管理的本地资源，减少反复手动修改 `~/.codex` 下多个文件的需要。

## 为什么需要 CGswitch？

Codex 的配置通常分布在多个文件中，而且供应商配置与 MCP、插件、Skill 属于不同类型的资源。CGswitch 将每套供应商配置保存为可命名、可切换的配置，支持编辑、测试，并在写入前创建备份后应用。

```text
供应商模板或现有 Codex 配置
              ↓
          保存为配置
              ↓
       编辑 · 测试 · 应用 · 恢复
```

供应商配置与全局 MCP、Plugins、Skills 管理区域相互独立。切换模型供应商时，不需要重新配置其他 Codex 资源。

## 功能

### 供应商配置

- 使用内置供应商模板、捕获当前 `~/.codex/config.toml`，或创建自定义供应商。
- 在应用内编辑 `config.toml`、`models.json` 和 `auth.json`，提供 TOML/JSON 校验与语法感知编辑器。
- 从供应商的 `/models` 接口获取可用模型，并在供应商配置编辑器中选择。
- 重命名、复制、排序、删除和应用配置。
- 应用配置时，尽可能保留 MCP、插件等无关 Codex 配置内容。
- 为配置设置自定义显示名称、供应商图标、管理后台地址，并可绑定 ChatGPT 账号。

### 当前支持的供应商模板

当前内置模板包括 `ChatGPT`、`DeepSeek`、`MiniMax CN`、`Zhipu CN`、`OpenCode`、`OpenRouter`、`Xiaomi MiMo`、`Kimi`、`Qwen`、`Tencent Hunyuan`、`Volcengine Doubao` 和 `Custom`。

自定义供应商可以使用 Codex 支持的 Responses API 兼容配置，并填写自己的接口地址、API Key 和模型目录。

### ChatGPT 账号与用量

- 使用 OAuth 设备码登录 ChatGPT。
- 管理多个账号、设置默认账号，并将账号绑定到指定供应商配置。
- 测试 ChatGPT 认证状态，并在可用时查看配额信息。
- 测试第三方供应商的 API 连通性、响应状态和延迟。
- 查看已支持供应商的余额或用量；ChatGPT 配额单独处理。

### MCP 管理

- 管理 `~/.codex/config.toml` 中全局的 `[mcp_servers.*]` 配置。
- 配置本地 `STDIO` 服务器和远程 `HTTP` / Streamable HTTP 服务器。
- 编辑命令、参数、URL、Bearer Token 环境变量、请求头、环境变量和超时。
- 在结构化表单与 TOML 源码之间切换，并提供校验和格式化。
- 在同步前比较 Codex 实际配置与 CGswitch 数据库镜像，明确选择同步方向。

### Plugins 与 Skills

- 列出已安装的 Codex 插件，查看版本、能力、内容、来源和安装路径。
- 浏览内置及外部插件 Marketplace。
- 从 GitHub 简写、Git、SSH 或本地 Marketplace 目录添加市场源。
- 预览并从 GitHub 仓库安装插件，可选指定分支或子目录。
- 检查并升级第三方 Marketplace 插件，也可以通过 Codex CLI 卸载插件。
- 导入本地 Skill，预览 `SKILL.md`，检测更新和冲突，并启用、禁用或删除受 CGswitch 管理的 Skill。
- 扫描 `~/.codex/skills` 和 `~/.agents/skills` 中的 Skill，同时将 CGswitch Skill 注册表与插件内置 Skill 分开管理。

### 桌面体验

- 基于 Tauri 2，提供 Windows 和 macOS 桌面版本。
- 支持浅色、深色和跟随系统主题。
- 支持英文和简体中文界面，并可自动检测系统语言。
- 支持开机启动、静默启动和关闭时最小化到托盘。
- 应用配置后可选择自动重启 Codex。
- 可自动检查应用更新，并在安装前查看更新日志。
- 管理本地数据库、配置文件和 Codex 文件备份。

## 下载与安装

请从 [GitHub Releases](https://github.com/zeno528/CGswitch/releases/latest) 下载最新版本。

| 平台 | 推荐文件 | 说明 |
| --- | --- | --- |
| Windows x64 | `CGswitch-v{VERSION}-Windows-setup.exe` | 常规安装程序。 |
| Windows x64 | `CGswitch-v{VERSION}-Windows.msi` | 适合部署或 MSI 安装场景。 |
| macOS Apple Silicon | `CGswitch-v{VERSION}-macOS-arm64.dmg` | 适用于 Apple Silicon 芯片。 |
| macOS Intel | `CGswitch-v{VERSION}-macOS-x64.dmg` | 适用于 Intel 芯片。 |

### macOS 首次打开

打开 DMG，将 **CGswitch** 拖入「应用程序」，然后启动。如果 macOS 阻止打开，请先在「系统设置 → 隐私与安全性」中允许。如果仍提示应用无法打开，在终端执行：

```bash
xattr -cr /Applications/CGswitch.app
```

如果应用安装在其他位置，请将命令中的路径替换为实际 `.app` 路径。目前官方发行包支持 Windows 和 macOS，暂不提供 Linux 安装包。

## 快速开始

1. 下载并启动 CGswitch。
2. 进入「供应商配置」，选择内置模板或「Custom」，填写供应商凭据或绑定 ChatGPT 账号。
3. 保存配置；需要时使用「测试连接」和「获取模型」，然后应用配置。
4. 如果希望应用后自动重启 Codex，在设置中开启对应选项。
5. 需要管理全局资源时，从侧边栏进入「MCP 管理」「插件」或「Skill」。

## 数据与隐私

CGswitch 将应用数据保存在当前用户的主目录下，实际文件和目录会随使用过的功能而变化：

```text
~/.cgswitch/
├── settings.json
├── cgswitch.db
├── balance-cache.json
├── skills/
└── backups/
    ├── config/
    ├── database/
    └── codex-files/
```

Codex 的实际配置仍位于 `~/.codex`：

```text
~/.codex/
├── config.toml
├── models.json
├── auth.json
├── plugins/
└── skills/
```

API Key、OAuth 凭据、配置和备份都属于本地数据。CGswitch 会在相关配置写入前创建备份，但仍请不要将 `.cgswitch`、`auth.json`、API Key 或备份文件提交到 Git 或分享给他人。

## 常见问题与排查

### Codex 配置在哪里？

主要配置是 `~/.codex/config.toml`；相关模型和认证文件是 `~/.codex/models.json` 与 `~/.codex/auth.json`。CGswitch 自身的数据库和备份位于 `~/.cgswitch`。

### 点击「应用」会发生什么？

CGswitch 会先备份相关文件，再更新供应商相关的 Codex 配置，并尽可能保留其他配置区域。操作完成后是否重启 Codex 由设置决定。

### 供应商配置、MCP、Plugins 和 Skills 是一回事吗？

不是。供应商配置描述模型和供应商设置；MCP 描述工具服务器；Plugins 是 Codex 扩展包；Skills 是可复用的指令目录。它们在应用的不同区域管理。

### 为什么配置了第三方供应商，插件仍然无法使用？

模型供应商的配置并不能保证所有 App 或 MCP Connector 插件都能加载。部分 Connector 插件还需要兼容的官方 ChatGPT 认证或其他依赖。插件已经安装但 Connector 不可用时，请查看插件自身要求。

### macOS 为什么无法打开应用？

请参阅[「macOS 首次打开」](#macos-首次打开)。Gatekeeper 可能需要手动允许，或对下载的应用执行 `xattr` 命令。

### 为什么连接测试失败？

第三方供应商先检查接口地址和 API Key；官方 ChatGPT 配置需要先在账号设置中完成登录，并确认选中的账号仍然有效。

如果问题仍未解决，请先搜索已有的 [Issues](https://github.com/zeno528/CGswitch/issues)，或提交包含系统、CGswitch 版本和脱敏错误信息的问题。不要附带 API Key 或认证文件。

## 开发

### 环境要求

- Node.js
- pnpm `11.9.0`
- 由 [`src-tauri/rust-toolchain.toml`](src-tauri/rust-toolchain.toml) 固定的 Rust 工具链
- Tauri 2 所需的平台开发依赖

### 安装与启动

```bash
pnpm install
pnpm dev:tauri
```

`pnpm dev:tauri` 会启动 Vite 前端和真实的 Tauri 桌面窗口。只开发前端时可以使用：

```bash
pnpm dev
```

### 检查与构建

```bash
pnpm typecheck
pnpm test:unit
pnpm check
pnpm build
pnpm build:debug
pnpm preview
```

`pnpm check` 会运行前端和 Rust 质量检查。`pnpm build` 生成 Web 构建产物；`pnpm build:debug` 生成 Tauri 调试包。需要在本地打包发行安装程序时运行：

```bash
pnpm tauri build
```

发行包位于 `src-tauri/target/release/bundle/`。

## 架构

CGswitch 使用轻量的本地桌面技术栈：

- React 和 TypeScript：应用界面。
- Vite、Tailwind CSS 和 CodeMirror：前端构建与编辑器。
- Tauri 2 和 Rust：原生文件访问、Codex 集成、连接测试、插件、Skill 和更新。
- SQLite：本地配置、账号、MCP 镜像和应用事件。
- 类型化的前端 IPC 层，以及用于前端开发和测试的浏览器 mock。

主要源码目录如下：

```text
src/
├── api/       类型化 IPC 方法和浏览器 mock
├── app/       应用壳层、导航、状态和轮询
└── features/  profiles、mcp、plugins、skills、settings、updates

src-tauri/src/
├── commands.rs
├── services/
├── database.rs
└── paths.rs
```

## 参与贡献

欢迎提交 Bug、功能建议、文档改进和 Pull Request。代码改动请运行上面的相关检查，并确保凭据、本地数据库和生成的构建产物不会进入提交。

- [提交 Issue](https://github.com/zeno528/CGswitch/issues)
- [查看更新日志](CHANGELOG.md)

## 许可证

CGswitch 使用 [MIT License](LICENSE) 发布。供应商图标来自 [thesvg.org](https://thesvg.org)，对应 SVG 文件中保留了来源声明。

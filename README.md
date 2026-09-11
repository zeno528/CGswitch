<p align="center">
  <img src="src-tauri/icons/icon.svg" width="112" alt="CGswitch logo" />
</p>

<h1 align="center">CGswitch</h1>

<p align="center">
  用档案管理 Codex / ChatGPT 的模型与供应商配置，随时切换，安全应用。
</p>



<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=20232A" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tauri_2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/CodeMirror_6-D30707?style=flat-square&logo=codemirror&logoColor=white" alt="CodeMirror 6" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-555?style=flat-square" alt="Windows and macOS" />
</p>

## CGswitch 是什么？

CGswitch 是一个面向 Codex / ChatGPT 桌面应用的配置管理工具。

它把不同模型、API 供应商和 ChatGPT 订阅账号保存为独立的“配置档案”。需要切换时，选择档案并点击应用即可；应用会更新 `~/.codex` 下的相关文件，并可按设置自动重启 Codex。

你可以把它理解为：

```text
当前配置 / 内置模板 / 自定义配置
              ↓
       保存为多个配置档案
              ↓
      编辑、测试、切换、恢复
```

## 功能

### 配置档案

- 捕获当前 `~/.codex/config.toml`，保存为可随时恢复的档案
- 内置 DeepSeek、MiniMax、智谱、ChatGPT、OpenCode、OpenRouter、小米 MiMo 模板
- 支持自定义供应商和自定义 `config.toml`
- 新建自定义供应商时 config.toml / models.json / auth.json 三个槽位选填，填了才保存
- 重命名、复制、排序、删除档案
- 为档案设置供应商图标、管理后台地址和显示名称

### 编辑与应用

- 在应用内编辑 `config.toml`、`models.json` 和 `auth.json`
- CodeMirror 编辑器提供 TOML / JSON 语法高亮
- 保存前校验 TOML / JSON 格式
- 从供应商的 /models 端点获取可用模型列表，直接在下拉中选择
- 应用配置时只更新相关字段，尽量保留 MCP、插件、注释等其他内容
- 支持绑定 ChatGPT 订阅账号到指定档案

### 连接与用量

- 测试第三方供应商的 API 连通性、状态码和延迟
- 测试 ChatGPT 订阅认证是否有效
- 查看 DeepSeek 余额
- 查看 MiniMax 余额或 Token Plan 用量与重置时间
- 查看智谱 GLM 用量（5 小时 / 7 天窗口），用量类供应商统一展示「用量」
- 余额和用量支持按供应商开启，成功结果会在本地缓存

### ChatGPT 账号

- 使用 OAuth 设备码登录 ChatGPT
- 管理多个 ChatGPT 订阅账号
- 设置默认账号，或将账号绑定到具体配置档案
- 支持移除账号并同步更新本地认证文件

### 桌面体验

- 自动检测 Codex / ChatGPT 桌面应用运行状态
- 应用配置后按需自动重启 Codex
- 支持浅色、深色和跟随系统主题
- 支持开机自启、静默启动和关闭时最小化到托盘
- Windows 与 macOS 桌面应用支持

### 备份与恢复

- 修改配置文件前自动创建备份
- 支持数据库导入 / 导出
- 支持查看、重命名、恢复和删除数据库备份
- 数据库、配置文件和关联的 Codex 文件分别保存备份

## macOS 安装说明

首次打开如果提示「"CGswitch" 已损坏，无法打开」，这是 macOS 对未签名应用的安全提示，不是软件损坏。按下面步骤操作一次即可：

1. 打开下载的 DMG，把 **CGswitch** 拖入「应用程序」文件夹
2. 打开「终端」（Terminal），执行：

   ```bash
   xattr -cr /Applications/CGswitch.app
   ```

3. 双击打开，之后正常使用，不会再出现任何提示

按芯片选择安装包：Apple Silicon（M1/M2/M3/M4）下载 `macOS-arm64.dmg`，Intel 芯片下载 `macOS-x64.dmg`。

## 安全与数据位置

CGSwitch 的档案、设置、账号信息和本地备份都保存在用户目录，不写入项目仓库：

```text
~/.cgswitch/
├── settings.json
├── cgswitch.db
├── balance-cache.json
└── backups/
    ├── config/
    ├── database/
    └── codex-files/
```

Codex 原始配置仍位于：

```text
~/.codex/config.toml
~/.codex/models.json
~/.codex/auth.json
```

API Key、OAuth 凭据和其他敏感内容只保存在本机。请不要将 `.cgswitch/`、数据库、备份或认证文件提交到 Git，也不要把它们分享给他人。

## 支持的使用方式

### 1. 使用内置模板

在首页添加供应商，选择内置模板，填写 API Key 或绑定 ChatGPT 账号，然后保存。

### 2. 捕获当前配置

先手动调整 `~/.codex/config.toml`，回到 CGSwitch 点击“捕获当前配置”，即可把当前状态保存为档案。

### 3. 应用配置

选择目标档案，点击“应用”。CGswitch 会在写入前备份相关文件，完成后按设置决定是否重启 Codex。

## 开发

### 环境要求

- Node.js
- pnpm
- Rust 工具链
- Tauri 2 的系统开发依赖

### 启动开发环境

```bash
pnpm install
pnpm dev:tauri
```

`pnpm dev:tauri` 会启动 Vite 和 Tauri 调试应用。React / CSS 修改会通过 Vite Fast Refresh 更新，Rust 修改会由 Tauri dev 自动重新编译。

### 调试构建

```bash
pnpm build:debug
```

调试产物位于 `src-tauri/target/debug/bundle/`。

### 构建发布包

```bash
pnpm tauri build
```

发布产物位于 `src-tauri/target/release/bundle/`，包括 Windows NSIS / MSI 和 macOS DMG。当前安装包未签名，macOS 用户首次打开需执行一次 `xattr` 命令，见上方 [macOS 安装说明](#macos-安装说明重要)。

## 技术栈

- React 19 + TypeScript
- Vite + Tailwind CSS
- Tauri 2 + Rust
- SQLite
- CodeMirror 6
- Radix UI + 原生 HTML 控件

## 许可证

本项目采用 [MIT License](LICENSE)。供应商图标来自 [thesvg.org](https://thesvg.org)，各 SVG 文件头保留了对应的来源声明。

欢迎通过 [Issues](https://github.com/zeno528/CGSwitch/issues) 反馈问题和建议。

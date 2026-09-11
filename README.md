<p align="center">
  <img src="src-tauri/icons/icon.svg" width="112" alt="CGswitch logo" />
</p>

<h1 align="center">CGswitch</h1>

<p align="center">
  A local-first desktop manager for Codex providers, accounts, MCP servers, plugins, and Skills.
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a> ·
  <a href="https://github.com/zeno528/CGswitch/releases/latest">Latest release</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/zeno528/CGswitch/issues">Issues</a>
</p>

<p align="center">
  <a href="https://github.com/zeno528/CGswitch/releases/latest"><img src="https://img.shields.io/github/v/release/zeno528/CGswitch?display_name=tag&sort=semver&style=flat-square" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-555?style=flat-square" alt="Windows and macOS" />
</p>

CGswitch is a Tauri desktop application for managing the configuration around the Codex ecosystem. It turns provider settings, ChatGPT subscription accounts, MCP servers, Codex plugins, and Skills into manageable local resources instead of requiring repeated manual edits under `~/.codex`.

## Why CGswitch?

Codex configuration often spans several files and different kinds of resources. CGswitch gives each provider configuration a named profile, lets you test or edit it, and applies the selected profile with a backup before writing.

```text
Provider preset or existing Codex configuration
                         ↓
                  Saved as a profile
                         ↓
            Edit · test · apply · restore
```

The provider profile flow is separate from the global MCP, Plugins, and Skills management areas, so switching a model provider does not require rebuilding the rest of your Codex setup.

## Features

### Provider profiles

- Start from a built-in provider preset, capture the current `~/.codex/config.toml`, or create a custom provider.
- Edit `config.toml`, `models.json`, and `auth.json` with TOML/JSON validation and syntax-aware editors.
- Fetch available models from a provider's `/models` endpoint and select them in the profile editor.
- Rename, duplicate, reorder, delete, and apply profiles.
- Keep unrelated Codex configuration such as MCP and plugin sections when applying provider-specific changes where possible.
- Set a custom display name, provider icon, administration URL, and optional ChatGPT account binding.

### Supported provider presets

The current built-in presets are `ChatGPT`, `DeepSeek`, `MiniMax CN`, `Zhipu CN`, `OpenCode`, `OpenRouter`, `Xiaomi MiMo`, `Kimi`, `Qwen`, `Tencent Hunyuan`, `Volcengine Doubao`, and `Custom`.

Custom providers can use the Responses API-compatible configuration supported by Codex, with their own endpoint, API key, and model catalog.

### ChatGPT accounts and usage

- Sign in to ChatGPT with an OAuth device code.
- Manage multiple accounts, choose a default account, and bind an account to a provider profile.
- Test ChatGPT authentication and inspect quota information when available.
- Test third-party provider connectivity, including response status and latency.
- View provider balance or usage indicators for supported providers; ChatGPT quota is handled separately.

### MCP management

- Manage the global `[mcp_servers.*]` configuration in `~/.codex/config.toml`.
- Configure local `STDIO` servers and remote `HTTP` / Streamable HTTP servers.
- Edit commands, arguments, URLs, bearer-token environment variables, headers, environment variables, and timeouts.
- Switch between a structured form and TOML source editing with validation and formatting.
- Compare the live Codex configuration with CGswitch's database mirror before syncing either direction.

### Plugins and Skills

- List installed Codex plugins and inspect their versions, capabilities, contents, source, and install path.
- Browse bundled and external plugin marketplaces.
- Add marketplaces from GitHub shorthand, Git, SSH, or a local marketplace directory.
- Preview and install a plugin from a GitHub repository, optionally using a branch or subdirectory.
- Check and upgrade third-party marketplace plugins, or uninstall plugins through the Codex CLI.
- Import local Skills, preview their `SKILL.md`, detect updates and conflicts, and enable, disable, or delete managed Skills.
- Scan Skills from `~/.codex/skills` and `~/.agents/skills` while keeping the CGswitch Skill registry separate from plugin-contained Skills.

### Desktop experience

- Windows and macOS desktop builds powered by Tauri 2.
- Light, dark, and system theme modes.
- English and Simplified Chinese interface languages, with system-language detection.
- Optional launch at login, silent start, and minimize-to-tray behavior.
- Optional Codex restart after applying a profile.
- Optional automatic update checks with release notes before installation.
- Local database, configuration-file, and Codex-file backup management.

## Download and installation

Download the latest build from the [GitHub Releases page](https://github.com/zeno528/CGswitch/releases/latest).

| Platform | Recommended asset | Notes |
| --- | --- | --- |
| Windows x64 | `CGswitch-v{VERSION}-Windows-setup.exe` | Standard installer. |
| Windows x64 | `CGswitch-v{VERSION}-Windows.msi` | Useful for deployment or MSI-based installation. |
| macOS Apple Silicon | `CGswitch-v{VERSION}-macOS-arm64.dmg` | For Apple Silicon Macs. |
| macOS Intel | `CGswitch-v{VERSION}-macOS-x64.dmg` | For Intel Macs. |

### macOS first launch

Open the DMG, drag **CGswitch** to **Applications**, and launch it. If macOS blocks the app, first allow it in **System Settings → Privacy & Security**. If it still reports that the app cannot be opened, run:

```bash
xattr -cr /Applications/CGswitch.app
```

Replace the path if you installed the app somewhere else. Official packages are currently published for Windows and macOS; Linux packages are not included.

## Quick start

1. Download and launch CGswitch.
2. Open **Providers**, add a built-in preset or **Custom**, then enter the provider credentials or bind a ChatGPT account.
3. Save the profile, use **Test connection** and **Get models** when available, then apply the profile.
4. Enable the optional Codex restart behavior if you want CGswitch to restart Codex after applying changes.
5. Use **MCP**, **Plugins**, or **Skill** in the sidebar when you need to manage those global resources.

## Data and privacy

CGswitch keeps its application data under the current user's home directory. The exact files and folders depend on which features have been used:

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

The live Codex files remain under `~/.codex`:

```text
~/.codex/
├── config.toml
├── models.json
├── auth.json
├── plugins/
└── skills/
```

API keys, OAuth credentials, profiles, and backups are local data. CGswitch creates backups before relevant configuration writes, but you should still avoid committing or sharing `.cgswitch`, `auth.json`, API keys, or backup files.

## FAQ and troubleshooting

### Where is my Codex configuration?

The main live configuration is `~/.codex/config.toml`; related model and authentication files are `~/.codex/models.json` and `~/.codex/auth.json`. CGswitch's own database and backups are under `~/.cgswitch`.

### What happens when I apply a profile?

CGswitch backs up the relevant files, updates the provider-related Codex configuration, and preserves unrelated configuration areas where possible. You can choose whether Codex should restart after the operation.

### Are profiles, MCP, Plugins, and Skills the same thing?

No. Profiles describe model/provider settings; MCP describes tool servers; Plugins are Codex extension packages; Skills are reusable instruction directories. They are managed in separate areas of the application.

### Why can a third-party plugin still fail after a provider is configured?

A model provider configuration does not guarantee that every App or MCP connector plugin can load. Some connector plugins also require compatible official ChatGPT authentication or their own dependencies. Check the plugin's requirements if its package is installed but a connector is unavailable.

### Why cannot macOS open the app?

See [macOS first launch](#macos-first-launch). Gatekeeper may require an explicit allow action or the `xattr` command for the downloaded app.

### Why did a connection test fail?

For a third-party provider, check the endpoint and API key first. For the official ChatGPT profile, sign in through the account settings and make sure the selected account is still valid.

If the problem persists, search existing [Issues](https://github.com/zeno528/CGswitch/issues) or open a new report with the platform, CGswitch version, and a redacted error message. Do not include API keys or authentication files.

## Development

### Requirements

- Node.js
- pnpm `11.9.0`
- Rust toolchain pinned by [`src-tauri/rust-toolchain.toml`](src-tauri/rust-toolchain.toml)
- The platform prerequisites required by Tauri 2

### Install and run

```bash
pnpm install
pnpm dev:tauri
```

`pnpm dev:tauri` starts the Vite frontend and a real Tauri desktop window. For frontend-only browser development, use:

```bash
pnpm dev
```

### Checks and builds

```bash
pnpm typecheck
pnpm test:unit
pnpm check
pnpm build
pnpm build:debug
pnpm preview
```

`pnpm check` runs the frontend and Rust quality checks. `pnpm build` creates the web build; `pnpm build:debug` creates a debug Tauri bundle. To package release installers locally:

```bash
pnpm tauri build
```

Release bundles are written under `src-tauri/target/release/bundle/`.

## Architecture

CGswitch uses a small local desktop stack:

- React and TypeScript for the UI.
- Vite, Tailwind CSS, and CodeMirror for the frontend tooling and editors.
- Tauri 2 and Rust for native file access, Codex integration, connections, plugins, Skills, and updates.
- SQLite for local profiles, accounts, MCP mirrors, and application events.
- A typed frontend IPC layer with a browser mock for frontend development and tests.

The main source areas are organized as follows:

```text
src/
├── api/       typed IPC methods and browser mock
├── app/       shell, navigation, state, and polling
└── features/  profiles, mcp, plugins, skills, settings, updates

src-tauri/src/
├── commands.rs
├── services/
├── database.rs
└── paths.rs
```

## Contributing

Bug reports, feature ideas, documentation improvements, and pull requests are welcome. For code changes, run the relevant checks above and keep credentials, local databases, and generated bundles out of commits.

- [Open an issue](https://github.com/zeno528/CGswitch/issues)
- [View the changelog](CHANGELOG.md)

## License

CGswitch is released under the [MIT License](LICENSE). Provider icons are sourced from [thesvg.org](https://thesvg.org); the corresponding SVG files retain their source notices.

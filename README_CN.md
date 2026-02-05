# Awesome-Skills-Hub (ASH) 🚀

一个轻量级的 AI IDE 技能（Skills/Rules）管理工具，旨在跨平台同步和分发 AI 提示词、规则与架构指令。

[English](README.md) | **简体中文**

[![NPM Version](https://img.shields.io/npm/v/awesome-skills-hub?color=red)](https://www.npmjs.com/package/awesome-skills-hub)
[![License](https://img.shields.io/npm/l/awesome-skills-hub)](https://github.com/tiandee/awesome-skills-hub/blob/main/LICENSE)

---

## 🌟 核心亮点

- **双重作用域管理 (Dual-Scope)**：完美支持 **从全局 (个人)** 和 **从项目 (团队)** 两个维度管理技能。
- **通用 IDE 桥接 (Universal Bridge)**：标准化的 `.claude/skills` 架构，自动生成兼容 **Cursor**, **Windsurf**, **TRAE**, **Antigravity** 和 **Copilot** 的桥接配置。
- **Homebrew 式管理**：将技能统一托管在系统家目录 (`~/.ash`)，做 IDE 之外的"军火库"。
- **实时软链**：本地更新技能文件，所有关联的 IDE 瞬间生效。
- **智能交互**：支持模糊搜索、批量安装以及 "Did you mean?" 拼写纠错。

### 1. 快速安装 (推荐)

**通过 NPM (跨平台首选):**
```bash
npm install -g awesome-skills-hub
# 安装完成后，请运行初始化命令：
ash init
```

### 2. 备选安装 (Shell 脚本)
如果您没有安装 Node.js：

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/tiandee/awesome-skills-hub/main/install.sh | bash
```

**Windows (待适配):**
> Windows 原生支持正在重构中，请暂时使用 WSL (Windows Subsystem for Linux)。
> ```powershell
> # (即将推出)
> # iwr https://raw.githubusercontent.com/tiandee/awesome-skills-hub/main/install.ps1 -useb | iex
> ```

### 2. 手动安装 (Clone)
如果您希望参与贡献代码：

**macOS / Linux:**
```bash
# 执行安装脚本
bash install.sh

# 重启终端或运行源配置
source ~/.zshrc  # 或 ~/.bashrc
```

**Windows (待适配):**
> 开发环境请暂时使用 WSL。
> ```powershell
> # (即将推出)
> # .\install.ps1
> # . $PROFILE
> ```

**安装脚本将自动执行：**
1. 检测并初始化本地所有主流 AI IDE 环境。
2. **初始化全局目录**：在您的家目录创建 `~/.ash/skills` (Windows 为 `~\.ash\skills`) 作为持久化存储。
3. 自动配置环境变量，支持 **Zsh**, **Bash** 和 **Fish**。
4. 实现全局命令 `ash` 的一键访问。

### 2. 环境初始化 (可选)
如果您以后安装了新的 IDE，只需运行：
```bash
ash init
```

## 📖 使用手册

### 1. 浏览技能库
查看来自 Anthropic 官方的实用技能：

```bash
ash list
```

### 2. 查看技能详情
了解某个技能的详细用途、触发词或内容预览：

```bash
ash info pdf       # 支持模糊匹配名称
```

### 3. 安装技能 (全局 / 用户级)
将技能链接到您的 **用户家目录** (User Home Directory)，即刻在所有支持的 IDE 全局配置中生效。

```bash
ash install pdf           # 智能通过名称安装 (全局)
ash install --all         # 一键同步所有 17+ 技能到所有 IDE
```

### 4. 项目模式 (本地安装 / 项目级) 🆕
将技能直接安装到 **当前项目目录**，方便团队共享或隔离使用。
ASH 强制使用 `.claude/skills` 作为核心标准，并**自动桥接**到您当前的 IDE 配置目录。

```bash
cd my-project
ash install java -p              # 安装到当前项目的 ./.claude/skills
ash install --all -p             # 将所有技能批量注入当前项目
```

**支持自动桥接的 IDE**:
- `.cursor/skills` (Cursor)
- `.windsurf/skills` (Windsurf)
- `.trae/skills` (TRAE)
- `.trae-cn/skills` (TRAE CN)
- `.agent/skills` (Antigravity)
- `.copilot/skills` (Copilot)

### 5. 状态与搜索
```bash
ash search web            # 关键词搜索
ash status                # 查看当前安装映射状态
```

### 6. 清理与重置
一键清空指定 IDE 或所有 IDE 的技能链接（不会删除源码）。

```bash
ash clean cursor          # 仅清空 Cursor 的技能
ash clean --all           # 清空所有 IDE 的技能 (核弹选项)
```

### 7. 卸载技能
移除技能链接。支持 `--all` 标志一键清理。

```bash
ash uninstall pdf         # 卸载指定技能
ash uninstall --all       # (同 clean --all)
```

### 8. 同步技能库
从源码仓库或远程同步最新的技能到全局目录。

```bash
ash sync
```

### 9. CLI 工具维护
管理 `ash` 工具本身的实用指令：

```bash
# 升级到最新版本
npm update -g awesome-skills-hub

# 查看当前已安装版本
npm list -g awesome-skills-hub

# 查询远程最新版本号
npm view awesome-skills-hub version

# 卸载 CLI 工具
npm uninstall -g awesome-skills-hub
```

## 🧩 目录架构

- **软件家目录 (`ASH_HOME`)**: `~/.ash` (或 `$env:USERPROFILE\.ash`)
- **技能存储仓**: `~/.ash/skills/`
- **IDE 链接目标**: 所有 IDE 中的软链接均精准指向上述全局目录。

## 🧩 交互亮点

- **智能纠错**：输错命令时（如 `ash intall`），工具会智能提示：“您是不是想输入 `ash install`？”
- **透明反馈**：批量操作时提供清晰的 IDE 级汇总汇总报告，确保操作可审计。

## 🤝 支持平台

| 平台 | 目标路径 | 支持程度 |
| :--- | :--- | :--- |
| **Google Antigravity** | `~/.agent/skills/` | ✅ 完美支持 |
| **Cursor** | `~/.cursor/skills/` | ✅ 完美支持 |
| **TRAE (国际版)** | `~/.trae/skills/` | ✅ 完美支持 |
| **TRAE (中国版)** | `~/.trae-cn/skills/` | ✅ 完美支持 |
| **Windsurf** | `~/.windsurf/skills/` | ✅ 完美支持 |
| **VS Code + Copilot** | `~/.copilot/skills/` | ✅ 完美支持 |
| **Claude Code** | `~/.claude/skills/` | ✅ 完美支持 |

## 🛠️ 贡献代码

欢迎贡献您的实用提示词或规则！

1. Fork 本仓库。
2. 在 `skills/<name>/` 中创建您技能目录。
3. 添加 `SKILL.md` (内容) 和可选的 `scripts/`。
4. 提交 Pull Request。

## 📄 开源协议

MIT © Tiandee

# Awesome-Skills-Hub (ASH) 🚀

一个轻量级的 AI IDE 技能（Skills/Rules）管理工具，旨在跨平台同步和分发 AI 提示词、规则与架构指令。

[English](README.md) | **简体中文**

[![NPM Version](https://img.shields.io/npm/v/awesome-skills-hub?color=red)](https://www.npmjs.com/package/awesome-skills-hub)
[![License](https://img.shields.io/npm/l/awesome-skills-hub)](https://github.com/tiandee/awesome-skills-hub/blob/main/LICENSE)

---

## 🌟 核心亮点

- **双重作用域 (Dual-Scope)**：支持 **全局作用域**（用户目录 `~/.ash/skills`）和 **项目作用域**（项目内的 IDE 技能配置目录）双维度管理。
- **通用 IDE 桥接**: 标准化的 `.claude/skills` 架构，自动生成兼容 **Cursor**, **Windsurf**, **TRAE**, **Antigravity** 和 **Copilot** 的桥接配置。
- **Homebrew 式管理**：将技能统一托管在系统家目录 (`~/.ash`)，做 IDE 之外的"军火库"。
- **实时软链**：本地更新技能文件，所有关联的 IDE 瞬间生效。
- **智能交互**：支持模糊搜索、批量安装以及拼写纠错。

---

## 📦 安装指南

### 1. 免安装试用 (Zero-Install)
无需安装，直接通过 `npx` 运行：

> **💡 小贴士**: 您可以使用短别名 `npx askill` 代替冗长的 `npx awesome-skills-hub`。

```bash
# 1. 浏览技能库
npx askill list

# 2. 安装技能 (自动初始化并同步到 IDE)
npx askill install pdf
```

> **💡 小贴士**: 免安装模式仅限可以使用**内置技能**。如需**管理完整技能库**（包括添加自定义技能）并获得秒级响应，请务必使用 **快速安装**。

### 2. 快速安装 (推荐)

**通过 NPM (跨平台首选):**
```bash
# 1. 全局安装 (获取 'ash' 命令，将其加入系统 PATH)
npm install -g awesome-skills-hub

# 2. 初始化环境 (自动检测您的 IDE 并创建 ~/.ash 技能库)
ash init

# 3. 验证安装 (查看所有可用技能)
ash list
```

### 3. 备选安装 (Shell 脚本)
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
> # . $PROFILE
> ```

### 4. 手动安装 (Clone)
如果您希望参与贡献代码：

**macOS / Linux:**
```bash
# 执行安装脚本
bash install.sh

# 重启终端或运行源配置
source ~/.zshrc  # 或 ~/.bashrc
```

**安装脚本将自动执行：**
1. 检测并初始化本地所有主流 AI IDE 环境。
2. **初始化全局目录**：在您的家目录创建 `~/.ash/skills` (Windows 为 `~\.ash\skills`) 作为持久化存储。
3. 自动配置环境变量，支持 **Zsh**, **Bash** 和 **Fish**。
4. 实现全局命令 `ash` 的一键访问。

---

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
将技能链接到您的 **用户家目录** (`~/.ash/skills`)，即刻在所有支持的 IDE 全局配置中生效。

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
![Cursor](https://img.shields.io/badge/Cursor-Supported-blue?logo=cursor&logoColor=white)
![Windsurf](https://img.shields.io/badge/Windsurf-Supported-blueviolet)
![TRAE](https://img.shields.io/badge/TRAE-Supported-00a1ff)
![Antigravity](https://img.shields.io/badge/Antigravity-Supported-4285F4?logo=google)
![Copilot](https://img.shields.io/badge/Copilot-Supported-black?logo=github)

### 5. 状态与搜索
```bash
ash search web            # 关键词搜索
ash status                # 查看当前安装映射状态
```

### 6. 清理与重置
一键清空指定 IDE 或所有 IDE 的技能链接。

```bash
ash clean cursor          # 仅清空 Cursor 的技能
ash clean --all           # 清空所有 IDE 的技能 (核弹选项)
```

### 7. 卸载技能
移除技能链接。

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
管理 `ash` 工具本身：

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

---

## 📂 系统架构

- **软件家目录 (`ASH_HOME`)**: `~/.ash` (或 `$env:USERPROFILE\.ash`)
- **技能存储仓**: `~/.ash/skills/`
- **IDE 链接目标**: 所有 IDE 中的软链接均精准指向上述全局目录。

## 🧩 交互亮点

- **智能纠错**：输错命令时（如 `ash intall`），工具会智能提示：“您是不是想输入 `ash install`？”
- **透明反馈**：批量操作时提供清晰的 IDE 级汇总汇总报告，确保操作可审计。

## 🤝 支持平台

| 平台 | 目标路径 | 状态 |
| :--- | :--- | :--- |
| ![Antigravity](https://img.shields.io/badge/Antigravity-4285F4?style=flat-square&logo=google&logoColor=white) | `~/.agent/skills/` | ✅ |
| ![Cursor](https://img.shields.io/badge/Cursor-000000?style=flat-square&logo=cursor&logoColor=white) | `~/.cursor/skills/` | ✅ |
| ![TRAE](https://img.shields.io/badge/TRAE-00A1FF?style=flat-square) | `~/.trae/skills/` | ✅ |
| ![Windsurf](https://img.shields.io/badge/Windsurf-5D3FD3?style=flat-square) | `~/.windsurf/skills/` | ✅ |
| ![Copilot](https://img.shields.io/badge/Copilot-171515?style=flat-square&logo=github&logoColor=white) | `~/.copilot/skills/` | ✅ |
| ![Claude](https://img.shields.io/badge/Claude-D97757?style=flat-square&logo=anthropic&logoColor=white) | `~/.claude/skills/` | ✅ |

## 🛠️ 贡献代码

欢迎贡献您的实用提示词或规则！

1. Fork 本仓库。
2. 在 `skills/<name>/` 中创建您技能目录。
3. 添加 `SKILL.md` (内容) 和可选的 `scripts/`。
4. 提交 Pull Request。

## 📄 开源协议

MIT © Tiandee

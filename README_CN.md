# Awesome-Skills-Hub (ASH) 🚀

一个轻量级的 AI IDE 技能（Skills/Rules）管理工具，旨在跨平台同步和分发 AI 提示词、规则与架构指令。

[English](README.md) | **简体中文**

[![NPM Version](https://img.shields.io/npm/v/askill?color=red)](https://www.npmjs.com/package/askill)
[![License](https://img.shields.io/npm/l/askill)](https://github.com/tiandee/awesome-skills-hub/blob/main/LICENSE)

---

## 🌟 核心亮点

- **双重作用域 (Dual-Scope)**：支持 **全局作用域**（用户目录 `~/.ash/skills`）和 **项目作用域**（项目内的 IDE 技能配置目录）双维度管理。
- **通用 IDE 桥接**: 标准化的 `.claude/skills` 架构，自动生成兼容 **Cursor**, **Windsurf**, **TRAE**, **Antigravity** 和 **Copilot** 的桥接配置。
- **Homebrew 式管理**：将技能统一托管在系统家目录 (`~/.ash`)，做 IDE 之外的"军火库"。
- **实时软链**：本地更新技能文件，所有关联的 IDE 瞬间生效。
- **Vercel Labs 集成**：支持自动导入 `npx skills` 下载的技能 (详见[第五节](#5-vercel-labs-生态集成-vercel-integration))。
- **智能 Monorepo 发现**: 交互式扫描并安装复杂仓库中的技能（支持多选/全选，如 `huggingface/skills`）。
- **元技能 (自我进化)**: 让 Agent 学会自主使用 `ash` 来扩展自己的能力 (`ash search` -> `ash add`)。

## 💡 为什么选择 ASH? ("桥梁"哲学)

与那些仅提供**skills**下载（仓库型）或试图统一所有 Agent 格式（加载器型）的工具不同，**ASH** 的定位是一座物理 **桥梁 (Bridge)**。

| 特性 | 🛠️ 其他工具 (如 OpenSkills) | 🚀 ASH (本项目) |
| :--- | :--- | :--- |
| **设计哲学** | **加载器 (Loader)**: 为特定 Agent 生成配置文件。 | **桥梁 (Bridge)**: 直接将技能投递到 IDE 的"家门口" (`~/.cursor/skills` 等)。 |
| **兼容性** | 需要 Agent 支持特定标准/插件。 | **通用性**: 只要 IDE 读取配置文件，ASH 就即刻可用，无需等待插件适配。 |
| **分发效率** | "一个技能装一次" | **"一次安装，处处可用"**: 只要装一次，瞬间同步给 8+ 个主流 IDE。 |
| **发现机制** | 手动指定路径 | **智能 Monorepo 扫描**: 自动探测子目录中的技能。 |

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
npm install -g askill

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
ash add pdf               # 智能通过名称安装 (全局)。(install 的现代别名)
ash add --all             # 一键同步所有 17+ 技能到所有 IDE
```

### 4. 项目模式 (本地安装 / 项目级) 🆕
将技能直接安装到 **当前项目目录**，方便团队共享或隔离使用。
ASH 强制使用 `.claude/skills` 作为核心标准，并**自动桥接**到您当前的 IDE 配置目录。

```bash
cd my-project
ash add java -p              # 安装到当前项目的 ./.claude/skills
ash add --all -p             # 将所有技能批量注入当前项目
```

**支持自动桥接的 IDE**:
![Cursor](https://img.shields.io/badge/Cursor-Supported-blue?logo=cursor&logoColor=white)
![Windsurf](https://img.shields.io/badge/Windsurf-Supported-blueviolet)
![TRAE](https://img.shields.io/badge/TRAE-Supported-00a1ff)
![Antigravity](https://img.shields.io/badge/Antigravity-Supported-4285F4?logo=google)
![Copilot](https://img.shields.io/badge/Copilot-Supported-black?logo=github)


### 5. Vercel Labs 生态集成 (Vercel Integration)
**ASH 能够自动感知并导入 Vercel 生态的技能。**
Vercel 官方推出了 `npx skills` 工具，它将技能下载到 `~/.agents/skills`。ASH 可以自动扫描该目录，将上面的优质技能**一键桥接**到所有 IDE 中。

1. **下载**: 使用 Vercel 工具下载你喜欢的技能：
   ```bash
   npx skills add user/repo
   ```
2. **同步**: 让 ASH 接管并分发：
   ```bash
   ash sync
   ```
   *(此时 ASH 会提示发现新技能，确认后即可在 Cursor/Windsurf 等工具中直接使用)*

### 💡 资源推荐
想要寻找优质的中文 Skill？推荐访问 **[Skill Hub 中国](https://www.skill-cn.com)**。
该网站收录了大量高质量的 agent 技能，例如 Anthropic 官方的前端设计技能：

```bash
# 示例：安装 Anthropic 的 frontend-design 技能
npx skills add https://github.com/anthropics/skills --skill frontend-design

# 让 ASH 自动分发
ash sync
```

### 6. 状态与搜索
```bash
ash search web            # 关键词搜索
ash status                # 查看当前安装映射状态
```

### 7. 清理与重置
一键清空指定 IDE 或所有 IDE 的技能链接。

```bash
ash clean cursor          # 仅清空 Cursor 的技能
ash clean --all           # 清空所有 IDE 的技能 (核弹选项)
```

### 8. 卸载技能
移除技能链接。

```bash
ash uninstall pdf         # 卸载指定技能
ash uninstall --all       # (同 clean --all)
```

### 9. 同步技能库
从源码仓库或远程同步最新的技能到全局目录。

```bash
ash sync
```

### 10. CLI 工具维护
管理 `ash` 工具本身：

```bash
# 升级到最新版本
npm update -g askill

# 查看当前已安装版本
npm list -g askill

# 查询远程最新版本号
npm view askill version

# 卸载 CLI 工具
npm uninstall -g askill
```

---

## 📂 系统架构

- **软件家目录 (`ASH_HOME`)**: `~/.ash` (或 `$env:USERPROFILE\.ash`)
- **技能存储仓**: `~/.ash/skills/`
- **IDE 链接目标**: 所有 IDE 中的软链接均精准指向上述全局目录。

## 🧩 交互亮点

- **智能纠错**：输错命令时（如 `ash ad`），工具会智能提示：“您是不是想输入 `ash add`？”
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

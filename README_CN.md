# Awesome-Skills-Hub (ASH) 🚀

> **一处管理，全平台同步** — 技能装一次，Cursor、Claude、Windsurf 等主流 AI IDE 即刻可用。

[![NPM Version](https://img.shields.io/npm/v/askill?color=red)](https://www.npmjs.com/package/askill)
[![License](https://img.shields.io/npm/l/askill)](https://github.com/tiandee/awesome-skills-hub/blob/main/LICENSE)

[English](README.md) | **简体中文** | [贡献指南](CONTRIBUTING.md)

---

## 📑 目录

- [🌟 核心亮点](#-核心亮点)
- [💡 为什么选择 ASH?](#-为什么选择-ash-桥梁哲学)
- [📦 安装指南](#-安装指南)
- [📖 使用手册](#-使用手册)
- [🚀 生态集成](#-生态集成-ecosystem-integration)
- [📂 系统架构](#-系统架构)
- [🤝 支持平台](#-支持平台)
- [🛠️ 贡献代码](#️-贡献代码)

---

## 🌟 核心亮点

- **双重作用域 (Dual-Scope)**：支持 **全局作用域**（通用目录 `~/.agents/skills`）和 **项目作用域**（项目内的 IDE 技能配置目录）双维度管理。
- **通用 IDE 桥接**: 标准化的 `.claude/skills` 架构，自动生成兼容 **Cursor**, **Windsurf**, **TRAE**, **Antigravity** 和 **Copilot** 的桥接配置。
- **Homebrew 式管理**：将技能统一托管在标准 Agents 目录 (`~/.agents/skills`)，做客户端之外的"军火库"。
- **实时软链**：更新通用库中的 Skill，所有已关联客户端立即生效。
- **生态集成**：直接复用 `npx skills` 下载的技能，不再维护第二份副本（详见[生态集成节](#-生态集成-ecosystem-integration)）。
- **智能 Monorepo 发现**: 交互式扫描并安装复杂仓库中的技能（支持多选/全选，如 `huggingface/skills`）。
- **元技能 (Meta-Skill)**: 赋能您的 Agent 自主搜索并安装所需技能 (`ash search` -> `ash add`)。

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

# 2. 初始化环境 (自动检测 IDE 并准备 ~/.agents/skills 通用库)
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

**Windows (已支持):**
```powershell
# PowerShell 一键安装（若未安装 Git 请先安装）
irm https://raw.githubusercontent.com/tiandee/awesome-skills-hub/main/install.ps1 | iex
# 重载配置后即可使用 ash 命令
. $PROFILE
```

### 4. 手动安装 (Clone)
如果您希望参与贡献代码：

**macOS / Linux:**
```bash
# 执行安装脚本
bash install.sh

# 重启终端或运行源配置
source ~/.zshrc  # 或 ~/.bashrc
```

**Windows:**
```powershell
# 克隆后在项目目录执行
.\install.ps1
# 重载配置
. $PROFILE
```

**安装脚本将自动执行：**
1. 检测并初始化本地所有主流 AI IDE 环境。
2. **初始化通用目录**：向 `~/.agents/skills`（Windows 为 `~\.agents\skills`）补充缺失的内置 Skill，绝不覆盖现有同名条目。
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
从通用 **Agents 技能库** (`~/.agents/skills`) 将 Skill 链接到检测到的客户端目录。

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


### 5. 命令参考 (CLI Reference) 🆕

| 命令 | 用途描述 | 基本用法示例 |
| :--- | :--- | :--- |
| **`init`** | **初始化 ASH 环境**。准备 `~/.agents/skills`、ASH 状态目录及检测到的客户端目录。 | `ash init` |
| **`list`** | **列出可用技能**。显示所有内置、下载及系统技能的名称、分类和物理路径。 | `ash list` (别名: `ls`) |
| **`add`** | **安装并分发技能**。将指定技能软链接到所有支持的 AI IDE 中。同时也支持从 GitHub 直接下载并安装。 | `ash add <技能名>`<br>`ash add <GitHub_URL>`<br>`ash add --all` (全装) |
| **`info`** | **查看技能详情**。显示技能的元数据、描述以及核心 Prompt 的预览。 | `ash info <技能名>` |
| **`search`** | **搜索技能**。在技能名称和描述中通过关键词检索。 | `ash search <关键词>` |
| **`status`** | **查看部署状态**。显示各 IDE 已安装的技能总数。支持查看特定 IDE 的详细映射。 | `ash status`<br>`ash status --full`<br>`ash status cursor` |
| **`inventory`** | **统一资产视图**。聚合 ASH、Agents 锁文件、Codex Store、系统及插件 Skill。 | `ash inventory`<br>`ash inventory --json` |
| **`doctor`** | **健康检查**。检查元数据、链接、锁文件、所有权冲突和生成物。 | `ash doctor`<br>`ash doctor --verbose` |
| **`repair`** | **安全一键修复**。默认仅预览；`--apply` 后只补齐缺失/断裂的 ASH 链接并记录事务。 | `ash repair`<br>`ash repair --apply` |
| **`rollback`** | **事务回滚**。默认预览；回滚前验证链接目标与文件哈希，避免覆盖后续修改。 | `ash rollback latest`<br>`ash rollback latest --apply` |
| **`catalog`** | **生成统一目录**。输出、校验或写入本机 ASH Skill 目录。 | `ash catalog`<br>`ash catalog --write` |
| **`package`** | **确定性打包**。生成内容可复现的 `.skill` 包，并自动排除 `.env`。 | `ash package pdf`<br>`ash package --all` |
| **`uninstall`** | **移除技能链接**。从各 IDE 的技能目录中通过软链接移除指定技能（不删源文件）。 | `ash uninstall <技能名>`<br>`ash uninstall --all` |
| **`clean`** | **清空 IDE 目录**。一键清空某个 IDE 或所有 IDE 下的所有技能链接。 | `ash clean <ide_name>`<br>`ash clean --all` |
| **`sync`** | **仓库同步**。拉取仓库更新，并仅向通用库补充缺失的内置 Skill。 | `ash sync` |

---

## 🩺 Skill 控制面与一键修复

ASH 现在把 `~/.agents/skills` 作为唯一的通用技能库和标准激活入口，既支持实体目录，也支持顶层 Skill 软链接。Cursor、Claude、TRAE 等客户端目录是分发目标；Codex Store、Codex 系统和插件 Skill 仍保持只读聚合。`~/.ash` 只保存控制面状态、目录、安装包和可回滚事务。

升级时，写操作会递归发现旧 `~/.ash/skills` 中的 Skill，并只把缺失名称补迁为标准扁平布局，绝不覆盖已有同名条目；ASH 已不再从旧目录加载。处理完同名冲突后即可归档旧目录。

```bash
ash inventory             # 查看所有来源和所有权
ash doctor                # 只读诊断；首次运行也不会创建目录
ash repair                # 预览确定性修复计划
ash repair --apply        # 执行安全动作并保存回滚事务
ash rollback latest       # 预览最近一次回滚
ash rollback latest --apply
```

修复器不会覆盖普通文件、实体目录、其他来源的有效软链接，也不会修改 Codex Store、系统 Skill 或插件缓存。来源、目标和输出位置可以在 [`ash-control.json`](ash-control.json) 中配置。完整设计见 [`doc/SKILL_CONTROL_PLANE.md`](doc/SKILL_CONTROL_PLANE.md)。

---

## 🚀 生态集成 (Ecosystem Integration)
**ASH 与 Vercel 生态直接共用标准 Agents 技能库。**
Vercel 官方 `npx skills` 工具会把 Skill 下载到 `~/.agents/skills`。ASH 原地发现这些 Skill，不再复制导入，并可安全桥接到各客户端目录。

1. **下载**: 使用 Vercel 工具下载你喜欢的技能：
   ```bash
   npx skills add user/repo
   ```
2. **检查并桥接**：先预览冲突，再执行安全修复：
   ```bash
   ash doctor
   ash repair --apply
   ```
   `repair` 会跳过普通文件、实体目录及其他来源拥有的链接。

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
- **通用技能库**: `~/.agents/skills/`
- **ASH 状态与输出**: `~/.ash/state`、`~/.ash/CATALOG.md`、`~/.ash/packages`
- **客户端链接**: 检测到的 IDE 目录链接到通用库中的 Skill。

## 🧩 交互亮点

- **智能纠错**：输错命令时（如 `ash intall`），工具会智能提示："您是不是想输入 `ash install`？"
- **透明反馈**：批量操作时提供清晰的 IDE 级汇总报告，确保操作可审计。

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

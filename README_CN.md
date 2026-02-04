# Awesome-Skills-Hub (ASH) 🚀

一个轻量级的 AI IDE 技能（Skills/Rules）管理工具，旨在跨平台同步和分发 AI 提示词、规则与架构指令。

[English](README.md) | **简体中文**

---

## 🌟 核心理念

- **一次编写，到处运行**：只需维护一份技能文件，即可同步到所有主流 AI IDE。
- **软链接驱动**：仓库中的更新会立即反映在所有连接的 IDE 中，无需手动同步。
- **智能交互**：支持智能路径解析、批量操作以及人性化的拼写纠错建议。
- **CLI 工具**：提供简洁、专业的 `ash` 命令，轻松管理技能。

## 📦 安装指南

```bash
# 1. 克隆仓库
git clone https://github.com/tiandee/awesome-skills-hub.git
cd awesome-skills-hub

# 2. 执行安装脚本
bash install.sh

# 3. 生效配置 (macOS/zsh 用户)
source ~/.zshrc
```

**安装脚本将自动执行：**
1. 检测并初始化本地所有主流 AI IDE 环境。
2. 自动配置环境变量，支持 **Zsh**, **Bash** 和 **Fish**。
3. 实现全局命令 `ash` 的一键访问。

### 2. 环境初始化 (可选)
如果您以后安装了新的 IDE，只需运行：
```bash
ash init
```

## 📖 使用手册

### 1. 浏览技能库
查看来自 Anthropic 官方的实用技能（已按功能自动分类）：

```bash
ash list
```

### 2. 查看技能详情
了解某个技能的详细用途、触发词或内容预览：

```bash
ash info pdf       # 支持模糊匹配名称
```

### 3. 安装技能
将技能安装（链接）到所有检测到的 IDE。支持**智能路径解析**，您无需输入完整路径。

```bash
ash install pdf           # 智能通过名称安装
ash install --all         # 一键同步所有 16+ 技能到所有 IDE
```

### 4. 状态与搜索
```bash
ash search web            # 关键词搜索
ash status                # 查看当前安装映射状态
```

### 5. 卸载技能
移除技能链接。支持 `--all` 标志一键清理。

```bash
ash uninstall pdf.md      # 卸载指定技能
ash uninstall --all       # 卸载所有已安装技能
```

### 6. 同步更新
从远程仓库获取最新的技能。

```bash
ash sync
```

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
2. 在 `skills/<category>/<name>.md` 中创建您的技能文件。
3. 参考 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详细指南。
4. 提交 Pull Request。

## 📄 开源协议

MIT © Tiandee

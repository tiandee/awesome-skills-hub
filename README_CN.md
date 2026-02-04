# Awesome-Skills-Hub (ASH) 🚀

一个轻量级的 AI IDE 技能（Skills/Rules）管理工具，旨在跨平台同步和分发 AI 提示词、规则与架构指令。

[English](README.md) | **简体中文**

---

## 🌟 核心理念

- **一次编写，到处运行**：只需维护一份技能文件，即可同步到所有主流 AI IDE。
- **软链接驱动**：仓库中的更新会立即反映在所有连接的 IDE 中，无需手动同步。
- **CLI 工具**：提供简洁的 `ash` 命令，轻松管理技能。

## 📦 安装指南

### 1. 一键安装
克隆仓库并运行安装脚本：

```bash
git clone https://github.com/tiandee/awesome-skills-hub.git
cd awesome-skills-hub
sh install.sh
```

**安装脚本将自动执行：**
1. 检测并初始化本地 AI IDE 环境。
2. 将 `ash` 自动添加到您的环境变量路径 (`~/.zshrc` 或 `~/.bashrc`)。

### 2. 环境初始化 (可选)
如果您以后安装了新的 IDE，只需运行：
```bash
ash init
```

## 📖 使用手册

### 1. 列出可用技能
查看仓库中内置的技能。

```bash
ash list
```

### 2. 搜索技能
使用关键词快速查找。

```bash
ash search expert
```

### 3. 安装技能
将技能安装（链接）到所有检测到的 IDE。

```bash
ash install java/expert.md
```

### 4. 查看状态
查看当前已安装的技能及其映射关系。

```bash
ash status
```

### 5. 卸载技能
移除技能链接。支持 `--all` 标志一键清理。

```bash
ash uninstall expert      # 卸载指定技能
ash uninstall --all       # 卸载所有已安装技能
```

### 6. 同步更新
从远程仓库获取最新的技能。

```bash
ash sync
```

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

# Awesome Skills Hub (ASH) — AI IDE 界的"Homebrew"

> **一处管理，全平台同步** — 技能装一次，Cursor、Claude、Windsurf 等主流 AI IDE 即刻可用。

[![NPM Version](https://img.shields.io/npm/v/askill?color=red)](https://www.npmjs.com/package/askill)
[![License](https://img.shields.io/npm/l/askill)](https://github.com/tiandee/awesome-skills-hub/blob/main/LICENSE)

🌟 **GitHub**: [github.com/tiandee/awesome-skills-hub](https://github.com/tiandee/awesome-skills-hub)

---

## 🎯 一句话介绍

**ASH** 是一个跨平台的 AI 技能（Skills/Prompts/Rules）包管理器，让你像使用 `npm` 或 `Homebrew` 一样，**一键安装、统一管理、全端同步** 你的 AI 辅助能力。

---

## 🔥 痛点与解决方案

### 😫 你是否遇到过这些问题？

| 痛点 | 具体表现 |
|:---|:---|
| **割裂感强** | 在 Cursor 里调教好的 Prompt，换到 Windsurf 又得手动复制一遍 |
| **维护困难** | 精心打磨的 "Java 专家"、"Git 规范" 散落在各个项目文件夹 |
| **缺乏标准** | 每个 IDE 都有自己的技能目录，难以统一管理 |
| **团队协作难** | 好用的 Prompt 无法轻松共享给团队成员 |

### ✅ ASH 的解决之道

```
┌────────────────────────────────────────────────────────────┐
│                    ~/.ash/skills/                          │
│        （你的技能军火库，一处存储，全端链接）                  │
└─────────────┬──────────────┬───────────────┬───────────────┘
              │              │               │
              ▼              ▼               ▼
        ┌─────────┐    ┌─────────┐     ┌─────────┐
        │ Cursor  │    │Windsurf │     │  Claude │  ...
        └─────────┘    └─────────┘     └─────────┘
```

**一次安装，自动同步到所有 AI IDE。** 技能文件更新后，所有工具瞬间生效。

---

## 部分示例

1. 初始化（检测环境），指令会智能检测安装的IDE

![image-20260207002622679](https://tian-picture-bed.oss-cn-shanghai.aliyuncs.com/tech/image-20260207002622679.png)

2. 安装github技能库的skill，会自动检测技能库的可用skill

![image-20260207002917963](https://tian-picture-bed.oss-cn-shanghai.aliyuncs.com/tech/image-20260207002917963.png)

执行安装，会自动安装到本地的IDE全局目录

![image-20260207003101700](https://tian-picture-bed.oss-cn-shanghai.aliyuncs.com/tech/image-20260207003101700.png)

3. 查看本地技能仓库可用技能

![image-20260207003246130](https://tian-picture-bed.oss-cn-shanghai.aliyuncs.com/tech/image-20260207003246130.png)

![image-20260207003315700](https://tian-picture-bed.oss-cn-shanghai.aliyuncs.com/tech/image-20260207003315700.png)

4. 查看各IDE已安装技能

![image-20260207003348005](https://tian-picture-bed.oss-cn-shanghai.aliyuncs.com/tech/image-20260207003348005.png)

5. 一键安装全部技能到所有IDE

![image-20260207003443206](https://tian-picture-bed.oss-cn-shanghai.aliyuncs.com/tech/image-20260207003443206.png)

## ✨ 核心亮点

### ⚡️ 一键全端同步
```bash
ash add pdf
```
只需一条命令，自动检测你电脑上安装的 IDE（Cursor、Windsurf、Claude、Antigravity、Copilot、TRAE），并将技能注入到所有环境中。

### 🌉 智能桥接引擎
你只管维护一份标准的 Markdown 技能文件，ASH 自动创建软链接，**保持所有工具配置的一致性**。

### 📦 熟悉的包管理体验
```bash
ash list          # 查看可用技能
ash search web    # 搜索技能
ash add java      # 安装技能
ash status        # 查看部署状态
```

### 🛡️ 双模式支持

| 模式 | 适用场景 | 命令 |
|:---|:---|:---|
| **全局模式** | 个人常用工具箱（翻译、代码审查） | `ash add pdf` |
| **项目模式** | 团队协作规范（API 规范、代码风格） | `ash add java -p` |

项目模式下，技能跟随代码仓库，同事 `git clone` 后即刻生效！

---

## 🚀 极速上手

### 30 秒体验

无需安装任何依赖，直接在终端运行：

```bash
# 1. 查看有哪些技能
npx askill list

# 2. 安装一个技能（会自动同步到所有 IDE）
npx askill add pdf
```

### 正式安装

```bash
# 1. 全局安装
npm install -g askill

# 2. 初始化环境
ash init

# 3. 开始使用
ash list
```

---

## 🤝 支持的平台

| AI IDE | 技能目录 | 状态 |
|:---|:---|:---|
| ![Antigravity](https://img.shields.io/badge/Antigravity-4285F4?style=flat-square&logo=google&logoColor=white) | `~/.agent/skills/` | ✅ |
| ![Cursor](https://img.shields.io/badge/Cursor-000000?style=flat-square&logo=cursor&logoColor=white) | `~/.cursor/skills/` | ✅ |
| ![Claude](https://img.shields.io/badge/Claude-D97757?style=flat-square&logo=anthropic&logoColor=white) | `~/.claude/skills/` | ✅ |
| ![Windsurf](https://img.shields.io/badge/Windsurf-5D3FD3?style=flat-square) | `~/.windsurf/skills/` | ✅ |
| ![TRAE](https://img.shields.io/badge/TRAE-00A1FF?style=flat-square) | `~/.trae/skills/` | ✅ |
| ![Copilot](https://img.shields.io/badge/Copilot-171515?style=flat-square&logo=github&logoColor=white) | `~/.copilot/skills/` | ✅ |

---

## 📦 内置技能库

ASH 内置 **30+ 高质量技能**，涵盖：

- **文档处理**：PDF 阅读、DOCX 编辑
- **前端设计**：Anthropic 官方 Frontend Design
- **AI 生态**：HuggingFace 全家桶（模型训练、数据集、评估...）
- **效率工具**：Git 规范、代码审查、翻译助手
- **创意设计**：Canvas 设计、品牌指南

---

## 💡 与其他工具的对比

| 特性 | 🛠️ 其他工具 | 🚀 ASH |
|:---|:---|:---|
| **设计哲学** | 为单一 Agent 生成配置 | 直接投递到所有 IDE 的"家门口" |
| **兼容性** | 需要 IDE 支持特定标准 | 只要 IDE 读取配置文件，即刻可用 |
| **分发效率** | 一个技能装一次 | **一次安装，6+ IDE 同步** |
| **发现机制** | 手动指定路径 | 智能 Monorepo 扫描 |

---

## 🌐 生态集成

ASH 可以自动导入 Vercel `npx skills` 下载的技能：

```bash
# 使用 Vercel 工具下载
npx skills add anthropics/skills --skill frontend-design

# ASH 一键接管并分发
ash sync
```

---

## 📣 适合谁？

- 🧑‍💻 **个人开发者**：告别重复复制粘贴，一处管理所有 AI 助手的能力
- 👥 **团队负责人**：统一团队的 Prompt 规范，新人 clone 即用
- 🔧 **效率狂人**：像管理代码依赖一样管理你的 AI Skills

---

## 🔗 相关链接

- **GitHub**: [github.com/tiandee/awesome-skills-hub](https://github.com/tiandee/awesome-skills-hub)
- **NPM**: [npmjs.com/package/askill](https://www.npmjs.com/package/askill)
- **Issues**: [提交问题或建议](https://github.com/tiandee/awesome-skills-hub/issues)

---

> **"Write Once, Link Everywhere."**
>
> 用 ASH，让你的 AI 技能库真正 **跨平台、易维护、可复用**。

---

MIT © Tiandee

# Awesome Skills Hub (ASH) — The "Homebrew" for AI IDEs

> **One skill library, every AI IDE** — install once, sync to Cursor, Claude, Windsurf, and more.

[![NPM Version](https://img.shields.io/npm/v/askill?color=red)](https://www.npmjs.com/package/askill)
[![License](https://img.shields.io/npm/l/askill)](https://github.com/tiandee/awesome-skills-hub/blob/main/LICENSE)

🌟 **GitHub**: [github.com/tiandee/awesome-skills-hub](https://github.com/tiandee/awesome-skills-hub)

---

## 🎯 What is ASH?

**ASH** is a cross-platform package manager for AI Skills (Prompts/Rules/Instructions). Think of it as `npm` or `Homebrew` for your AI capabilities — **install once, manage centrally, sync everywhere**.

---

## 🔥 The Problem & Solution

### 😫 Sound Familiar?

| Pain Point | What Happens |
|:---|:---|
| **Fragmented Experience** | Crafted a perfect prompt in Cursor? Now copy-paste it to Windsurf manually |
| **Maintenance Nightmare** | Your "Java Expert" and "Git Standards" prompts scattered across project folders |
| **No Standardization** | Every IDE has its own skills directory — impossible to unify |
| **Team Collaboration** | Sharing great prompts with teammates is harder than it should be |

### ✅ How ASH Solves This

```
┌────────────────────────────────────────────────────────────┐
│                  ~/.agents/skills/                         │
│       (Universal Skill library and Agents activation root) │
└─────────────┬──────────────┬───────────────┬───────────────┘
              │              │               │
              ▼              ▼               ▼
        ┌─────────┐    ┌─────────┐     ┌─────────┐
        │ Cursor  │    │Windsurf │     │  Claude │  ...
        └─────────┘    └─────────┘     └─────────┘
```

**Install once, auto-sync to all AI IDEs.** Update a skill file, and all tools reflect the change instantly.

---

## ✨ Key Features

### ⚡️ One-Command Multi-IDE Sync
```bash
ash add pdf
```
One command auto-detects your installed IDEs (Cursor, Windsurf, Claude, Antigravity, Copilot, TRAE) and injects the skill into all of them.

### 🌉 Smart Bridging Engine
Maintain a single Markdown skill file — ASH automatically creates symlinks to **keep all your tools in perfect sync**.

### 📦 Familiar Package Manager Experience
```bash
ash list          # View available skills
ash search web    # Search for skills
ash add java      # Install a skill
ash status        # Check deployment status
```

### 🛡️ Dual-Mode Support

| Mode | Use Case | Command |
|:---|:---|:---|
| **Global Mode** | Personal toolkit (translation, code review) | `ash add pdf` |
| **Project Mode** | Team standards (API specs, code style) | `ash add java -p` |

In project mode, skills travel with your repo — teammates get them instantly after `git clone`!

---

## 🚀 Quick Start

### 30-Second Trial

No installation required — run directly in your terminal:

```bash
# 1. Browse available skills
npx askill list

# 2. Install a skill (auto-syncs to all IDEs)
npx askill add pdf
```

### Full Installation

```bash
# 1. Install globally
npm install -g askill

# 2. Initialize environment
ash init

# 3. Start using
ash list
```

---

## 🤝 Supported Platforms

| AI IDE | Skills Directory | Status |
|:---|:---|:---|
| ![Antigravity](https://img.shields.io/badge/Antigravity-4285F4?style=flat-square&logo=google&logoColor=white) | `~/.agent/skills/` | ✅ |
| ![Cursor](https://img.shields.io/badge/Cursor-000000?style=flat-square&logo=cursor&logoColor=white) | `~/.cursor/skills/` | ✅ |
| ![Claude](https://img.shields.io/badge/Claude-D97757?style=flat-square&logo=anthropic&logoColor=white) | `~/.claude/skills/` | ✅ |
| ![Windsurf](https://img.shields.io/badge/Windsurf-5D3FD3?style=flat-square) | `~/.windsurf/skills/` | ✅ |
| ![TRAE](https://img.shields.io/badge/TRAE-00A1FF?style=flat-square) | `~/.trae/skills/` | ✅ |
| ![Copilot](https://img.shields.io/badge/Copilot-171515?style=flat-square&logo=github&logoColor=white) | `~/.copilot/skills/` | ✅ |

---

## 📦 Built-in Skill Library

ASH ships with **30+ high-quality skills**, including:

- **Document Processing**: PDF reading, DOCX editing
- **Frontend Design**: Anthropic's official Frontend Design skill
- **AI Ecosystem**: Full HuggingFace suite (model training, datasets, evaluation...)
- **Productivity**: Git standards, code review, translation assistant
- **Creative Design**: Canvas design, brand guidelines

---

## 💡 How ASH Compares

| Feature | 🛠️ Other Tools | 🚀 ASH |
|:---|:---|:---|
| **Philosophy** | Generate configs for a single Agent | Deliver skills to every IDE's doorstep |
| **Compatibility** | Requires IDE to support specific standards | Works instantly — if the IDE reads config files |
| **Distribution** | Install once per tool | **Install once, sync to 6+ IDEs** |
| **Discovery** | Manual path specification | Smart Monorepo scanning |

---

## 🌐 Ecosystem Integration

ASH and Vercel's `npx skills` share the same universal library, so no import copy is required:

```bash
# Download with Vercel's tool
npx skills add anthropics/skills --skill frontend-design

# Preview conflicts, then bridge safely to client-specific roots
ash doctor
ash repair --apply
```

---

## 📣 Who is ASH For?

- 🧑‍💻 **Individual Developers**: Stop copy-pasting — manage all your AI assistant capabilities in one place
- 👥 **Team Leads**: Standardize prompt conventions across your team — new members get them on `clone`
- 🔧 **Productivity Enthusiasts**: Manage AI Skills like code dependencies

---

## 🔗 Links

- **GitHub**: [github.com/tiandee/awesome-skills-hub](https://github.com/tiandee/awesome-skills-hub)
- **NPM**: [npmjs.com/package/askill](https://www.npmjs.com/package/askill)
- **Issues**: [Report bugs or suggest features](https://github.com/tiandee/awesome-skills-hub/issues)

---

> **"Write Once, Link Everywhere."**
>
> With ASH, make your AI skill library truly **cross-platform, maintainable, and reusable**.

---

MIT © Tiandee

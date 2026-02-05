# Awesome-Skills-Hub (ASH)

> **"Write Once, Link Everywhere"** - The "Homebrew" for AI IDE Skills.

[![NPM Version](https://img.shields.io/npm/v/awesome-skills-hub?color=red)](https://www.npmjs.com/package/awesome-skills-hub)
[![License](https://img.shields.io/npm/l/awesome-skills-hub)](https://github.com/tiandee/awesome-skills-hub/blob/main/LICENSE)

**Awesome-Skills-Hub (ASH) 🚀**

A lightweight package manager for AI IDE skills, rules, and architecture instructions.

**English** | [简体中文](README_CN.md)

---

Awesome-Skills-Hub (ASH) is a lightweight package manager designed to unify the management of AI Skills (Prompts, Rules, Instructions) across different AI coding environments.

Instead of copying and pasting your favorite "Expert Java Developer" prompt into Antigravity, Cursor, Windsurf, and Claude separately, `ash` lets you maintain a single "Source of Truth" in this repository and symlink it to all your tools instantly.

## 🚀 Features

- **Dual-Scope Management**: Support both **Global Scope** (`~/.ash/skills`) and **Project Scope** (Project-local).
- **Universal IDE Bridge**: Automatically compatibilizes with **Cursor**, **Windsurf**, **TRAE**, **Antigravity**, and **Copilot).
- **Centralized "Homebrew"**: Keep all your prompts in one place, independent of IDE configs.
- **Smart Interaction**: Name-based installation, batch operations, and "Did you mean?" suggestions.

---

## 📦 Installation

### 1. Zero-Install (Try it out)
Run instantly without installing anything:

```bash
npx awesome-skills-hub list
npx awesome-skills-hub info pdf
```

### 2. Quick Install (Recommended)

**Via NPM (Cross-Platform):**
```bash
npm install -g awesome-skills-hub
# After install, run this to initialize:
ash init
```

### 2. Alternative Install (Shell Script)
If you don't have Node.js installed:

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/tiandee/awesome-skills-hub/main/install.sh | bash
```

**Windows (Pending Adaptation):**
> Please use WSL for development and contribution for now.
> ```powershell
> # (Coming Soon)
> # .\install.ps1
> # . $PROFILE
> ```

### 3. Manual Install (Clone)
If you prefer managing the repo yourself:

**macOS / Linux:**
```bash
# Run installer
bash install.sh

# Reload shell config
source ~/.zshrc  # or ~/.bashrc
```

---

## 📖 Usage Manual

### 1. Browse Skill Library
Browse official Anthropic skills:

```bash
ash list
```

### 2. View Skill Details
Get detailed descriptions, triggers, and content previews:

```bash
ash info pdf       # Supports smart name matching
```

### 3. Install a Skill (Global / User Level)
Link a skill to your **User Home Directory** (`~/.ash/skills`).

```bash
ash install pdf           # Install by name (Global)
ash install --all         # Sync all 17+ skills to all IDEs at once
```

### 4. Project Mode (Local Install) 🆕
Install skills directly into your **Current Project Directory**.
ASH enforces `.claude/skills` consistency but **automatically bridges** to your IDE.

```bash
cd my-project
ash install java -p              # Install to ./.claude/skills
ash install --all -p             # Install ALL skills to project
```

**Supported IDE Bridges**:
![Cursor](https://img.shields.io/badge/Cursor-Supported-blue?logo=cursor&logoColor=white)
![Windsurf](https://img.shields.io/badge/Windsurf-Supported-blueviolet)
![TRAE](https://img.shields.io/badge/TRAE-Supported-00a1ff)
![Antigravity](https://img.shields.io/badge/Antigravity-Supported-4285F4?logo=google)
![Copilot](https://img.shields.io/badge/Copilot-Supported-black?logo=github)

### 5. Search & Status
```bash
ash search web            # Keyword search
ash status                # Check current installation map
```

### 6. Clean & Reset
Instantly clear skill links.

```bash
ash clean cursor          # Clear Cursor skills only
ash clean --all           # Clear ALL IDE skills
```

### 7. Uninstall
Remove specific symlinks.

```bash
ash uninstall pdf         # Uninstall specific skill
ash uninstall --all       # (Same as clean --all)
```

### 8. Sync Skills
Pull latest skills to Global Home.

```bash
ash sync
```

### 9. CLI Maintenance
Manage the tool itself.

```bash
# Upgrade to the latest version
npm update -g awesome-skills-hub

# Check current installed version
npm list -g awesome-skills-hub

# Check latest available version on NPM
npm view awesome-skills-hub version

# Uninstall CLI tool
npm uninstall -g awesome-skills-hub
```

---

## 📂 System Architecture

- **ASH Home**: `~/.ash` (or `$env:USERPROFILE\.ash`)
- **Global Skills Hub**: `~/.ash/skills/`
- **Persistent Links**: All IDE symlinks point to this stable global path.

## 🧩 UX Highlights

- **Smart Suggestions**: Type a typo (e.g., `ash intall`) and get a "Did you mean?" hint.
- **Transparent Feedback**: Detailed IDE-level reports for batch operations.

## 🤝 Supported Platforms

| Platform | Target Path | Status |
| :--- | :--- | :--- |
| ![Antigravity](https://img.shields.io/badge/Antigravity-4285F4?style=flat-square&logo=google&logoColor=white) | `~/.agent/skills/` | ✅ |
| ![Cursor](https://img.shields.io/badge/Cursor-000000?style=flat-square&logo=cursor&logoColor=white) | `~/.cursor/skills/` | ✅ |
| ![TRAE](https://img.shields.io/badge/TRAE-00A1FF?style=flat-square) | `~/.trae/skills/` | ✅ |
| ![Windsurf](https://img.shields.io/badge/Windsurf-5D3FD3?style=flat-square) | `~/.windsurf/skills/` | ✅ |
| ![Copilot](https://img.shields.io/badge/Copilot-171515?style=flat-square&logo=github&logoColor=white) | `~/.copilot/skills/` | ✅ |
| ![Claude](https://img.shields.io/badge/Claude-D97757?style=flat-square&logo=anthropic&logoColor=white) | `~/.claude/skills/` | ✅ |

## 🛠️ Contributing

Got a killer prompt or a useful rule? We'd love to have it!

1. Fork the repository.
2. Create your skill directory in `skills/<name>/`.
3. Add `SKILL.md` (content) and optional `scripts/`.
4. Submit a Pull Request.

## 📄 License

MIT © Tiandee

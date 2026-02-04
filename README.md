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

- **Centralized Management**: Keep all your prompts in one Git repository.
- **Cross-Platform**: Supports **Antigravity**, **Cursor**, **Windsurf**, **TRAE**, and **Claude CLI**.
- **Persistent Storage (ASH_HOME)**: Skills are stored in your home directory (`~/.ash`). Your IDE links remain intact even if you delete the cloned repository.
- **Symlink-Based**: Updates in the repository immediately reflect in all your connected IDEs.
- **Smart Interaction**: Name-based installation, batch operations, and "Did you mean?" suggestions.
- **CLI Tool**: Professional `ash` command to manage your AI workspace.

### 1. Quick Install (Recommended)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/tiandee/awesome-skills-hub/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr https://raw.githubusercontent.com/tiandee/awesome-skills-hub/main/install.ps1 -useb | iex
```

**NPM (Node.js):**
```bash
npm install -g awesome-skills-hub
```

### 2. Manual Install (Clone)
If you prefer managing the repo yourself or want to contribute:

**macOS / Linux:**
```bash
# Run installer
bash install.sh

# Reload shell config
source ~/.zshrc  # or ~/.bashrc
```

**Windows (PowerShell):**
```powershell
# Run installer
.\install.ps1

# Reload profile
. $PROFILE
```

**The installer will:**
1. Detect and initialize all mainstream AI IDE environments.
2. **Setup ASH_HOME**: Create `~/.ash/skills` (or `~\.ash\skills` on Windows) for persistent storage.
3. Configure environment variables for **Zsh**, **Bash**, and **Fish**.
4. Enable global `ash` command access instantly.

### 1. Browse Skill Library
Browse official Anthropic skills automatically categorized:

```bash
ash list
```

### 2. View Skill Details
Get detailed descriptions, triggers, and content previews:

```bash
ash info pdf       # Supports smart name matching
```

### 3. Install a Skill
Link a skill to all detected IDEs. Support **Smart Path Resolution**—no need to type full paths.

```bash
ash install pdf           # Install by name
ash install --all         # Sync all 16+ skills to all IDEs at once
```

### 4. Search & Status
```bash
ash search web            # Keyword search
ash status                # Check current installation map
```

### 5. Uninstall
Remove symlinks with ease.

```bash
ash uninstall pdf.md      # Uninstall specific skill
ash uninstall --all       # Clean up everything everywhere
```

### 6. Update
Pull the latest skills from the repository and sync them to your global home.

```bash
ash sync
```

## 📂 System Architecture

- **ASH Home**: `~/.ash` (or `$env:USERPROFILE\.ash`)
- **Global Skills Hub**: `~/.ash/skills/`
- **Persistent Links**: All IDE symlinks point to this stable global path, not the temporary clone directory.

## 📂 Repository Structure

```text
awesome-skills-hub/
├── skills/                  # The Skills Library
│   ├── java/                # Java-related skills
│   ├── python/              # Python-related skills
│   └── general/             # General coding rules
├── bin/
│   └── ash                  # CLI Executable
├── inventory.json           # (Coming Soon) Local state tracking
└── install.sh               # Setup script
```

## 🧩 UX Highlights

- **Smart Suggestions**: Type a typo (e.g., `ash intall`) and get a "Did you mean?" hint.
- **Transparent Feedback**: Detailed IDE-level reports for batch operations.

## 🤝 Supported Platforms

| Platform | Target Path | Support Level |
| :--- | :--- | :--- |
| **Google Antigravity** | `~/.agent/skills/` | ✅ Full Support |
| **Cursor** | `~/.cursor/skills/` | ✅ Full Support |
| **TRAE** | `~/.trae/skills/` | ✅ Full Support |
| **TRAE CN** | `~/.trae-cn/skills/` | ✅ Full Support |
| **Windsurf** | `~/.windsurf/skills/` | ✅ Full Support |
| **VS Code + Copilot** | `~/.copilot/skills/` | ✅ Full Support |
| **Claude Code** | `~/.claude/skills/` | ✅ Full Support |

## 🛠️ Contributing

Got a killer prompt or a useful rule? We'd love to have it!

1. Fork the repository.
2. Create your skill file in `skills/<category>/<name>.md`.
3. detailed instructions in [CONTRIBUTING.md](CONTRIBUTING.md).
4. Submit a Pull Request.

## 📄 License

MIT © Tiandee

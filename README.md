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

- **Dual-Scope Management**: Support both **Global Scope** (User Home `~/.ash/skills`) and **Project Scope** (Project-local IDE configuration).
- **Universal IDE Bridge**: Automatically creates compatibility bridges for **Cursor**, **Windsurf**, **TRAE**, **Antigravity**, and **Copilot**, unifying them under `.claude/skills`.
- **Centralized "Homebrew"**: Keep all your prompts in one place (`~/.ash`), independent of specific IDE configurations.
- **Live Symlinks**: Updates in the repository immediately reflect in all your connected IDEs.
- **Smart Interaction**: Name-based installation, batch operations, and "Did you mean?" suggestions.

### 1. Quick Install (Recommended)

**Via NPM (Cross-Platform):**
```bash
npm install -g awesome-skills-hub
# After install, run this to initialize:
ash init
```

### 2. Manual Install (Clone)
If you prefer managing the repo yourself or want to contribute:

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

**The installer will:**
1. Detect and initialize all mainstream AI IDE environments.
2. **Setup ASH_HOME**: Create `~/.ash/skills` (or `~\.ash\skills` on Windows) for persistent storage.
3. Configure environment variables for **Zsh**, **Bash**, and **Fish**.
4. Enable global `ash` command access instantly.

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
Link a skill to your **User Home Directory**, making it available across all your projects in supported IDEs.

```bash
ash install pdf           # Install by name (Global)
ash install --all         # Sync all 17+ skills to all IDEs at once
```

### 4. Project Mode (Local Install) 🆕
Install skills directly into your **Current Project Directory** for team sharing or isolation.
ASH enforces `.claude/skills` as the standard source of truth but **automatically bridges** to your IDE.

```bash
cd my-project
ash install java -p              # Install to ./.claude/skills
ash install --all -p             # Install ALL skills to project
```

**Supported Bridges (Auto-Created)**:
- `.cursor/skills` (Cursor)
- `.windsurf/skills` (Windsurf)
- `.trae/skills` (TRAE)
- `.trae-cn/skills` (TRAE CN)
- `.agent/skills` (Antigravity)
- `.copilot/skills` (Copilot)

### 5. Search & Status
```bash
ash search web            # Keyword search
ash status                # Check current installation map
```

### 6. Clean & Reset
Instantly clear skill links from distinct IDEs or all of them.

```bash
ash clean cursor          # Clear Cursor skills only
ash clean --all           # Clear ALL IDE skills (Nuclear option)
```

### 7. Uninstall
Remove specific symlinks.

```bash
ash uninstall pdf         # Uninstall specific skill
ash uninstall --all       # (Same as clean --all)
```

### 8. Sync Skills
Pull the latest skills from the repository and sync them to your global home.

```bash
ash sync
```

### 9. CLI Maintenance
Useful commands for managing the `ash` tool itself:

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

## 📂 System Architecture

- **ASH Home**: `~/.ash` (or `$env:USERPROFILE\.ash`)
- **Global Skills Hub**: `~/.ash/skills/`
- **Persistent Links**: All IDE symlinks point to this stable global path.

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
2. Create your skill directory in `skills/<name>/`.
3. Add `SKILL.md` (content) and optional `scripts/`.
4. Submit a Pull Request.

## 📄 License

MIT © Tiandee

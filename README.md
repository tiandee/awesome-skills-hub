# Awesome-Skills-Hub (ASH) 🚀

> **One skill library, every AI IDE** — install once, sync to Cursor, Claude, Windsurf, and more.

[![NPM Version](https://img.shields.io/npm/v/askill?color=red)](https://www.npmjs.com/package/askill)
[![License](https://img.shields.io/npm/l/askill)](https://github.com/tiandee/awesome-skills-hub/blob/main/LICENSE)

A lightweight package manager for AI IDE skills, rules, and architecture instructions.

**English** | [简体中文](README_CN.md) | [Contributing](CONTRIBUTING.md)

---

## 📑 Table of Contents

- [🚀 Features](#-features)
- [💡 Why ASH?](#-why-ash-the-bridge-philosophy)
- [📦 Installation](#-installation)
- [📖 Usage Manual](#-usage-manual)
- [🚀 Ecosystem Integration](#-ecosystem-integration)
- [📂 System Architecture](#-system-architecture)
- [🤝 Supported Platforms](#-supported-platforms)
- [🛠️ Contributing](#️-contributing)

---

Awesome-Skills-Hub (ASH) is a lightweight package manager designed to unify the management of AI Skills (Prompts, Rules, Instructions) across different AI coding environments.

Chinese users can also discover more skills through [Skills宝](https://skilery.com).

Instead of copying and pasting your favorite "Expert Java Developer" prompt into Antigravity, Cursor, Windsurf, and Claude separately, `ash` uses the standard `~/.agents/skills` directory as one universal source of truth and safely links selected Skills to client-specific roots.

## 🚀 Features

- **Dual-Scope Management**: Support both **Global Scope** (`~/.agents/skills`) and **Project Scope** (Project-local).
- **Universal IDE Bridge**: Automatically compatibilizes with **Cursor**, **Windsurf**, **TRAE**, **Antigravity**, and **Copilot).
- **Centralized "Homebrew"**: Keep all your prompts in the standard Agents library, independent of client-specific IDE configs.
- **Live Symlinks**: Updates in the universal library immediately reflect in all connected IDEs.
- **Ecosystem Integration**: Reuse Skills downloaded via `npx skills` directly, without maintaining a second copy (see [Ecosystem Integration](#-ecosystem-integration)).
- **Smart Monorepo Discovery**: Interactive UI to scan and install skills from complex repositories (e.g., `huggingface/skills`).
- **Meta-Skill (Self-Discovery)**: Empower your Agent to autonomously search and install the skills it needs (`ash search` -> `ash add`).

## 💡 Why ASH? (The "Bridge" Philosophy)

Unlike other tools that just *download* **static skill content** (Repository) or try to *convert* formats (Loader), **ASH** acts as a physical **Bridge**.

| Feature | 🛠️ Other Tools (e.g., OpenSkills) | 🚀 ASH (This Tool) |
| :--- | :--- | :--- |
| **Philosophy** | **Loader**: Generates config files usually only for one Agent. | **Bridge**: Delivers skills directly to the IDE's doorstep (`~/.cursor/skills`, etc.). |
| **Compatibility** | Requires Agent to support a specific standard. | **Universal**: Works immediately with Cursor, Windsurf, Trae, etc., without waiting for plugin support. |
| **Distribution** | "One Skill, One Install" | **"Write Once, Link Everywhere"**: Install a skill once, and it syncs to 8+ IDEs instantly. |
| **Discovery** | Manual Path Entry | **Interactive Monorepo Scanning**: Auto-detects skills in subfolders. |

---

## 📦 Installation

### 1. Zero-Install (Try it out)
Run instantly without installing anything:

> **💡 Pro Tip**: You can use the short alias `npx askill` instead of `npx awesome-skills-hub`.

```bash
# 1. Browse Skill Library
npx askill list

# 2. Install a Skill (Auto-initializes & syncs to IDEs)
npx askill install pdf
```

> **💡 Pro Tip**: Zero-Install mode is primarily for trying **Built-in Skills**. To **manage your full library** (including adding custom skills) and unlock offline speed, please use **Quick Install**.

### 2. Quick Install (Recommended)

**Via NPM (Cross-Platform):**
```bash
# 1. Install globally (Unlocks the 'ash' command)
npm install -g askill

# 2. Initialize environment (Detects IDEs & prepares ~/.agents/skills)
ash init

# 3. Verify installation (List available skills)
ash list
```

### 3. Alternative Install (Shell Script)
If you don't have Node.js installed:

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/tiandee/awesome-skills-hub/main/install.sh | bash
```

**Windows (Supported):**
```powershell
# One-line install (requires Git)
irm https://raw.githubusercontent.com/tiandee/awesome-skills-hub/main/install.ps1 | iex
# Reload profile to use ash
. $PROFILE
```

### 4. Manual Install (Clone)
If you want to contribute code:

**macOS / Linux:**
```bash
# Run installer
bash install.sh

# Reload shell config
source ~/.zshrc  # or ~/.bashrc
```

**Windows:**
```powershell
# From project root after clone
.\install.ps1
# Reload profile
. $PROFILE
```

**The installer will:**
1. Detect and initialize all mainstream AI IDE environments.
2. **Prepare the universal library**: Add missing bundled Skills to `~/.agents/skills` (or `~\.agents\skills` on Windows) without overwriting existing entries.
3. Configure environment variables for **Zsh**, **Bash**, and **Fish**.
4. Enable global `ash` command access instantly.

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
Link a Skill from the universal **Agents library** (`~/.agents/skills`) to detected client directories.

```bash
ash add pdf               # Install by name (Global)
ash add --all             # Sync all 17+ skills to all IDEs at once
```

### 4. Project Mode (Local Install) 🆕 (Aliases: `add`, `install`)
Install a skill (e.g., `ash add expert`) directly into your **Current Project Directory**.
ASH enforces `.claude/skills` consistency but **automatically bridges** to your IDE.

```bash
cd my-project
ash add java -p              # Install to ./.claude/skills
ash add --all -p             # Install ALL skills to project
```

**Supported IDE Bridges**:
![Cursor](https://img.shields.io/badge/Cursor-Supported-blue?logo=cursor&logoColor=white)
![Windsurf](https://img.shields.io/badge/Windsurf-Supported-blueviolet)
![TRAE](https://img.shields.io/badge/TRAE-Supported-00a1ff)
![Antigravity](https://img.shields.io/badge/Antigravity-Supported-4285F4?logo=google)
![Copilot](https://img.shields.io/badge/Copilot-Supported-black?logo=github)


### 5. CLI Command Reference 🆕

| Command | Description | Usage Example |
| :--- | :--- | :--- |
| **`init`** | **Initialize ASH Environment**. Prepares `~/.agents/skills`, ASH state, and detected client roots. | `ash init` |
| **`list`** | **List Available Skills**. Shows names, categories, and paths of all skills. | `ash list` (Alias: `ls`) |
| **`add`** | **Install & Distribute**. Symlinks skills to IDEs. Supports local names or GitHub URLs. | `ash add <name>`<br>`ash add <GitHub_URL>`<br>`ash add --all` (Install all) |
| **`info`** | **View Skill Details**. Shows metadata, descriptions, and prompt previews. | `ash info <name>` |
| **`search`** | **Search Skills**. Search through names and descriptions using keywords. | `ash search <keyword>` |
| **`status`** | **Check Deployment**. Shows skill counts per IDE. Supports detailed IDE mapping. | `ash status`<br>`ash status --full`<br>`ash status cursor` |
| **`inventory`** | **Unified Inventory**. Aggregates ASH, Agents lock, Codex Store, system, and plugin Skills. | `ash inventory`<br>`ash inventory --json` |
| **`doctor`** | **Health Audit**. Checks metadata, links, locks, ownership conflicts, and generated artifacts. | `ash doctor`<br>`ash doctor --verbose` |
| **`repair`** | **Safe One-click Repair**. Dry-runs by default; `--apply` reconciles deterministic links and opted-in Codex user Skill migrations. | `ash repair`<br>`ash repair --apply` |
| **`rollback`** | **Transaction Rollback**. Validates link targets and file hashes before restoring anything. | `ash rollback latest`<br>`ash rollback latest --apply` |
| **`catalog`** | **Generate Catalog**. Print, verify, or write the local ASH Skill catalog. | `ash catalog`<br>`ash catalog --write` |
| **`package`** | **Deterministic Packaging**. Builds reproducible `.skill` archives and excludes `.env`. | `ash package pdf`<br>`ash package --all` |
| **`uninstall`**| **Remove Links**. Removes symlinks from IDEs without deleting source files. | `ash uninstall <name>`<br>`ash uninstall --all` |
| **`clean`** | **Wipe IDE Directory**. Clears all skill links from one or all IDEs. | `ash clean <ide>`<br>`ash clean --all` |
| **`sync`** | **Repository Sync**. Pull updates and add only missing bundled Skills to the universal library. | `ash sync` |

---

## 🩺 Skill Control Plane and Safe Repair

ASH treats `~/.agents/skills` as the only universal library and activation root. Real directories and top-level Skill symlinks are both supported. Cursor, Claude, TRAE, and other client-specific roots are reconciliation targets. The default policy transactionally migrates user-installed Codex Store and manual Codex-root Skills into Agents, while Codex system and plugin Skills remain read-only external sources. `~/.ash` stores only control-plane state, catalogs, packages, and recoverable transactions.

On upgrade, a mutating command discovers legacy Skills recursively and copies only missing names into the standard flat layout; existing Agents entries are never overwritten. ASH no longer loads `~/.ash/skills`. Review same-name conflicts before archiving it.

```bash
ash inventory             # Inspect every known source and owner
ash doctor                # Read-only audit, including on first run
ash repair                # Preview deterministic safe actions
ash repair --apply        # Apply actions and record a rollback transaction
ash rollback latest       # Preview the latest rollback
ash rollback latest --apply
```

Repair never overwrites regular files, real directories, or valid links owned by another source. With `policies.codex_user_skills` set to `migrate-to-agents`, it moves only user-installed Codex-root Skills, unregisters matching Store entries, and records a reversible transaction. Codex `.system` Skills and plugin caches are never moved. Configure policies, sources, targets, and outputs in [`ash-control.json`](ash-control.json); see [`doc/SKILL_CONTROL_PLANE.md`](doc/SKILL_CONTROL_PLANE.md) for the complete design.

---

## 🚀 Ecosystem Integration
**ASH directly shares the standard Agents library with the Vercel ecosystem.**
Vercel's official `npx skills` tool downloads Skills to `~/.agents/skills`. ASH discovers them in place—there is no import copy—and can safely bridge them to your client-specific IDE directories.

1. **Download**: Use Vercel's tool to grab a skill:
   ```bash
   npx skills add user/repo
   ```
2. **Audit and bridge**: Preview conflicts, then reconcile safe links:
   ```bash
   ash doctor
   ash repair --apply
   ```
   `repair` skips regular files, real directories, and links owned by another source.

### 💡 Recommended Resources
Looking for high-quality skills? Check out **[Skill Hub CN](https://www.skill-cn.com)**.
Chinese users can also discover more skills through **Skills宝**: https://skilery.com
It curates excellent skills, such as the official Anthropic Frontend Design skill:

```bash
# Example: Install Anthropic's frontend-design skill
npx skills add https://github.com/anthropics/skills --skill frontend-design

# Let ASH distribute it
ash sync
```

### 6. Search & Status
```bash
ash search web            # Keyword search
ash status                # Check current installation map
```

### 7. Clean & Reset
Instantly clear skill links.

```bash
ash clean cursor          # Clear Cursor skills only
ash clean --all           # Clear ALL IDE skills
```

### 8. Uninstall
Remove specific symlinks.

```bash
ash uninstall pdf         # Uninstall specific skill
ash uninstall --all       # (Same as clean --all)
```

### 9. Sync Skills
Pull latest skills to Global Home.

```bash
ash sync
```

### 10. CLI Maintenance
Manage the tool itself.

```bash
# Upgrade to the latest version
npm update -g askill

# Check current installed version
npm list -g askill

# Check latest available version on NPM
npm view askill version

# Uninstall CLI tool
npm uninstall -g askill
```

---

## 📂 System Architecture

- **ASH Home**: `~/.ash` (or `$env:USERPROFILE\.ash`)
- **Universal Skills Library**: `~/.agents/skills/`
- **ASH State and Outputs**: `~/.ash/state`, `~/.ash/CATALOG.md`, and `~/.ash/packages`
- **Client Links**: Detected IDE roots link to entries in the universal library.

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

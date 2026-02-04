# Awesome-Skills-Hub (ASH)

> **"Write Once, Link Everywhere"** - The "Homebrew" for AI IDE Skills.

**Awesome-Skills-Hub (ASH)** is a lightweight package manager designed to unify the management of AI Skills (Prompts, Rules, Instructions) across different AI coding environments.

Instead of copying and pasting your favorite "Expert Java Developer" prompt into Antigravity, Cursor, Windsurf, and Claude separately, `ash` lets you maintain a single "Source of Truth" in this repository and symlink it to all your tools instantly.

## 🚀 Features

- **Centralized Management**: Keep all your prompts in one Git repository.
- **Cross-Platform**: Supports **Antigravity**, **Cursor**, **Windsurf**, and **Claude CLI**.
- **Symlink-Based**: Updates in the repository immediately reflect in all your connected IDEs. No manual syncing required.
- **CLI Tool**: Simple `ash` command to manage installations.

## 📦 Installation

```bash
git clone https://github.com/tiandee/awesome-skills-hub.git
cd awesome-skills-hub
./install.sh
```

Or add to your path manually:
```bash
export PATH=$PATH:/path/to/awesome-skills-hub/bin
```

## 📖 Usage

### 1. Initialize
Detect installed AI IDEs and set up necessary directories.

```bash
ash init
```

### 2. List Available Skills
See what skills are available in the repository.

```bash
ash list
```

### 3. Install a Skill
Link a skill to your global AI configuration (Antigravity / Claude).

```bash
ash install java/expert.md
```

**Project-Specific Installation (Cursor/Windsurf)**:
To install a rule only for the current project (e.g., into `.cursor/rules/`):

```bash
cd my-project
ash install -p python/fastapi.md
```

### 4. Update
Pull the latest skills from the repository.

```bash
ash sync
```

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

## 🤝 Supported Platforms

| Platform | Target Path | Support Level |
| :--- | :--- | :--- |
| **Antigravity** | `~/.agent/skills/` | ✅ Full Support |
| **Claude CLI** | `~/.claude/skills/` | ✅ Full Support |
| **Cursor** | `.cursor/rules/` | ✅ Project-level Support |
| **Windsurf** | `~/.codeium/windsurf/cascade/` | 🚧 Planned |

## 🛠️ Contributing

Got a killer prompt or a useful rule? We'd love to have it!

1. Fork the repository.
2. Create your skill file in `skills/<category>/<name>.md`.
3. detailed instructions in [CONTRIBUTING.md](CONTRIBUTING.md).
4. Submit a Pull Request.

## 📄 License

MIT © Tiandee

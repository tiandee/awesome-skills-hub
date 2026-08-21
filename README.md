# Awesome Skills Hub (ASH)

> A focused manager for the universal user Skill library at `~/.agents/skills`.

[中文文档](README_CN.md) · [Control-plane design](doc/SKILL_CONTROL_PLANE.md)

ASH v2 manages one thing: user-owned Agent Skills. It creates, discovers, audits,
packages, and migrates Skills in `~/.agents/skills` without copying them into
Cursor, Claude, Windsurf, TRAE, Copilot, Codex, or any other client-specific root.

## Why v2 is smaller

Modern Agent tooling increasingly shares the standard Agents Skill location.
Maintaining a second layer of per-client symlinks created noisy diagnostics,
duplicated Bash and PowerShell implementations, and blurred ownership between
user Skills and system/plugin Skills.

ASH v2 therefore removes:

- per-Agent detection, linking, status, cleanup, and uninstall commands;
- project-mode `.claude/skills` bridges;
- bundled Skill payloads and automatic seeding into the user library;
- automatic migration from the retired `~/.ash/skills` directory;
- Codex Store, system Skill, plugin-cache, and untracked-Codex scanning;
- the legacy `add`/`install` GitHub downloader.

Agent-owned system and plugin Skills remain owned by their Agent. ASH never
copies, repairs, packages, or migrates them.

## Install

From npm after v2 is published:

```bash
npm install -g askill
ash init
```

From a source checkout:

```bash
git clone https://github.com/tiandee/awesome-skills-hub.git
cd awesome-skills-hub
npm install -g .
ash init
```

`ash init` only creates `~/.agents/skills` when needed. ASH ships no Skills and
never seeds or overwrites user-library content.

## Common workflows

```bash
# Inspect the user library
ash list
ash search release
ash info delivery-loop
ash inventory
ash ui

# Create a user Skill
ash create review-release \
  --description "Review release readiness and required evidence."

# Audit user Skill quality and local metadata
ash doctor
ash doctor --verbose

# Preview Codex guidance repair
ash repair
ash repair --apply

# Package user Skills
ash package delivery-loop
ash package --all
```

To install third-party user Skills, use an installer that writes to the standard
library, for example:

```bash
npx skills add owner/repository
ash doctor
```

## Command reference

| Command | Purpose |
| --- | --- |
| `ash init` | Create the user library when missing |
| `ash list` | List top-level user Skills |
| `ash info <name>` | Show one user Skill |
| `ash search <query>` | Search names and descriptions |
| `ash create <name>` | Create `SKILL.md` and `agents/openai.yaml` |
| `ash inventory` | Show the user library and Agents installer-lock drift |
| `ash doctor` | Audit metadata, broken user links, lock drift, artifacts, and Codex creation guidance |
| `ash repair` | Preview Codex-guidance writes |
| `ash rollback` | Roll back a completed repair transaction |
| `ash package` | Build deterministic `.skill` archives |
| `ash snapshot` | Create, restore, or verify a user-only migration snapshot |
| `ash sync` | Pull the ASH source checkout with `git pull --ff-only` |
| `ash ui` | Start the loopback-only local management page |

`sync` is not cross-machine synchronization and does not upload the user library.
Use snapshots for computer-to-computer migration.

## Local management page

```bash
ash ui
ash ui --port 4173 --no-open
```

`ash ui` starts a local HTTP server on `127.0.0.1` and opens the management
page. The page shows the configured user library, Skill metadata and source,
Doctor findings, repair plans, and the latest rollback transaction. It can also:

- add and remove persistent read-only scan roots without touching their files;
- collapse symlinked entries that resolve to the same physical Skill while
  retaining every location, and report only same-name/different-content roots;
- create standard Skill scaffolds in the managed user library;
- update a managed Skill description through a transactional, rollback-safe write;
- package any selected Skill into the configured package output;
- preview and remove a managed Skill from each row: real directories enter the
  ASH recovery area, symlinks lose only the managed entry without touching their
  source, and installer-lock state changes in the same transaction; Maintenance
  lists every recoverable entry for per-item restore or previewed, name-confirmed
  permanent deletion, plus a previewed delete-all action gated by an exact typed
  phrase containing the current recovery count;
- create, verify, and additively restore page-managed user-library snapshots;
- open the local snapshot directory directly from the page without applying or deleting anything;
- show source coverage, unavailable sources, missing baselines, and stale provenance;
- present seven concise update states while keeping errors, warnings, and info as
  an independent health dimension;
- preview and prune obsolete or expired transaction history while protecting the
  current safe rollback for each transaction type;
- discover exact-name skills.sh candidates for an untracked Skill, require a
  human source choice, then take it over from the selected exact URL (or a GitHub
  repository and path), or safely rebuild a comparable legacy baseline;
- propose a one-confirmation batch takeover for clearly dominant skills.sh
  candidates while skipping ambiguous, unavailable, or executable-risk entries;
- distinguish the skills.sh takeover channel from the GitHub code upstream, with
  safe links to the catalog page, repository, and exact `SKILL.md` source;
- retarget a source-locked Skill to a different GitHub upstream after previewing
  the file diff, then roll that change back from the last update transaction;
- check source-locked GitHub Skills for updates, preview file-level changes,
  update one managed Skill transactionally, and roll the update back safely.

Update preview explicitly distinguishes preserved local `.env`, `.local`, and
nested links from discarded caches such as `node_modules`, `__pycache__`, and
embedded `.git` data. Nothing is removed before confirmation, and the complete
previous directory remains available to the guarded update rollback.

Source statistics are derived from live user-library and installer-lock state;
records older than 180 days are reported but never modified. Transaction cleanup
is irreversible and confirmation-gated: repair, update, and removal histories
retain their newest 10 entries or anything from the last 30 days, and the
currently valid rollback or restore for each type is always protected.

The managed library still follows `library.path` or `ASH_SKILLS_DIR`. Additional
scan roots are stored in `~/.agents/.ash/state/control-plane/ui-preferences.json` and are
always observe-only. Snapshots created by the page live under the same state
directory and include only the managed user library.

ASH keeps generated state below the existing `~/.agents` namespace and does not
create a top-level `~/.ash` directory.

The browser does not execute or parse CLI commands. The local API and CLI call
the same `lib/control-plane` modules. Repair and rollback remain preview-first:
the page requires explicit confirmation, the server rescans and compares a
one-time plan digest, and the existing transaction and hash preflight stays
authoritative. The server refuses non-loopback binding and does not enable CORS.
Repository sync, untracked third-party installation, raw instruction editing,
and bypassing recovery to permanently delete the active user library remain
outside the page. Page removal is restricted to the managed user library and
always enters a recoverable transaction first; only recovery copies can then be
permanently deleted through a separate preview and typed confirmation.
Observe-only roots can only be removed as whole scan references.

## Maintenance priority

The local page and API are the primary surface for new interactive management
features. The v2 CLI command set is frozen except for page bootstrap, necessary
headless automation, compatibility, and safety fixes. A page feature does not
automatically need a matching CLI command. Shared behavior still belongs in
`lib/control-plane`, with CLI and API kept as thin adapters.

## Move user Skills to another computer

On the source computer:

```bash
ash snapshot create user-skills.ash-snapshot
```

Copy that file to the destination, then preview before writing:

```bash
ash snapshot restore user-skills.ash-snapshot
ash snapshot restore user-skills.ash-snapshot --apply
ash snapshot verify user-skills.ash-snapshot
```

Snapshots include only top-level Skills already present in `~/.agents/skills`.
Top-level Skill symlinks are materialized as portable directories. `.env`,
`.git`, `.local`, `node_modules`, Python bytecode, and nested symlinks are omitted
and counted. Restore creates only missing Skills, leaves identical Skills alone,
and refuses the whole write when any same-name destination differs.

## Doctor and repair boundaries

`ash doctor` does not check whether Skills are synchronized to any Agent. It
audits only:

- `SKILL.md` frontmatter, names, descriptions, size, and duplicate declarations;
- broken top-level links in `~/.agents/skills`;
- missing entries recorded by `~/.agents/.skill-lock.json`;
- existing package drift;
- hard-coded legacy `~/.codex/skills` paths;
- references to removed ASH v1 commands inside user Skill documentation;
- ASH's marker-delimited user-Skill guidance in `~/.codex/AGENTS.md`.

`ash repair` does not rewrite Skill instructions. It only writes, when configured,
ASH's own marker block in Codex `AGENTS.md`.
Repairs are dry-run by default, transactional, and rollback-safe.

## Configuration

ASH v2 uses `ash-control.json` schema version 2:

```json
{
  "schema_version": 2,
  "library": {
    "path": "~/.agents/skills",
    "exclude": []
  },
  "policies": {
    "codex_global_guidance": "manage"
  },
  "sources": {
    "agents_lock": "~/.agents/.skill-lock.json"
  },
  "output": {
    "state_dir": "~/.agents/.ash/state/control-plane",
    "packages": "~/.agents/.ash/packages"
  }
}
```

Legacy `targets`, `codex_user_skills`, `codex_root`, `codex_store_lock`, and
`plugin_cache` settings are rejected with a migration message rather than being
silently ignored.

## Development

```bash
npm test
npm pack --dry-run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for Skill and code contribution guidance.

## License

MIT

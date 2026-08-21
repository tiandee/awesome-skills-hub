# ASH v2 User Skill Control Plane

## Scope

ASH v2 manages only the universal user Skill library:

```text
~/.agents/skills/<skill-name>/SKILL.md
```

It does not discover, link, repair, package, or migrate client-specific, system,
Store, or plugin Skill roots. Those resources remain owned by the Agent or
installer that created them.

## Ownership model

| Resource | ASH authority |
| --- | --- |
| `~/.agents/skills/<name>` | Discover, validate, create when missing, package, and snapshot |
| `~/.agents/.skill-lock.json` | Read provenance and diagnostics; write only through confirmed source/update transactions |
| `~/.codex/AGENTS.md` | Manage only the marker-delimited ASH guidance block when enabled |
| `~/.agents/.ash/packages` | Generate deterministic `.skill` archives |
| `~/.agents/.ash/state/control-plane` | Store page preferences, snapshots, transactions, and rollback backups |
| Agent system/plugin/client roots | No discovery and no write authority |

Generated ASH state stays below `~/.agents/.ash`; v2 does not create a separate
top-level `~/.ash` home directory.

## Commands

```text
ash init
ash list|info|search
ash create <name> [--description TEXT]
ash inventory
ash doctor
ash repair [--scope all|codex-guidance] [--apply]
ash rollback [latest|ID] [--apply]
ash package <name>|--all
ash snapshot create|restore|verify
ash sync
ash ui [--port N] [--no-open]
```

Removed commands are not compatibility aliases:

```text
add, install, uninstall, status, clean, catalog
```

Use an ecosystem installer such as `npx skills add` to add third-party user
Skills directly to the universal library.

## Surface maintenance policy

The local page/API is the preferred surface for new interactive management
features. The v2 CLI command set is frozen except for UI bootstrap, necessary
headless automation, compatibility, and safety corrections. New page features
do not receive CLI aliases by default. When both surfaces need a capability,
its rules stay in `lib/control-plane` and both adapters call that one
implementation.

## Doctor

`doctor` checks only user-library concerns:

1. Required frontmatter and valid matching names.
2. Description presence and size.
3. Duplicate declared names and oversized root instructions.
4. Broken top-level user Skill symlinks.
5. Installer-lock entries missing from the user library.
6. Existing package drift.
7. Hard-coded retired `~/.codex/skills` paths.
8. References to retired ASH v1 commands in user Skill documentation.
9. The opted-in Codex creation-guidance block.

No client directory is detected or compared. Consequently, `doctor` never emits
per-Agent missing-link, inactive-target, or synchronization-conflict findings.

## Repair and rollback

`repair` can plan only ASH's marker-delimited block in Codex `AGENTS.md`.

The command is dry-run by default. `--apply` preflights regular-file ownership,
stores previous content and hashes in a transaction, writes atomically, and rolls
back completed operations if a later write fails. Explicit rollback validates
that generated files have not been user-modified before restoring them.

`repair` never rewrites `SKILL.md`, moves user directories, edits installer
locks, or creates links in an Agent directory.

## Local UI adapter

`ash ui` starts a dependency-free local HTTP adapter and static management page.
It binds to `127.0.0.1` by default and rejects non-loopback hosts. The adapter
does not spawn the CLI: both surfaces call the same discovery, Doctor, repair,
and rollback modules.

Read APIs return the managed user library plus any page-configured read-only
scan roots. `library.path` and `ASH_SKILLS_DIR` select the one managed library.
Write APIs require a page-session token and a one-time
preview token. Repair apply rebuilds the plan and compares its content digest;
rollback apply reloads the transaction and compares its hash. Any drift causes
the write to be rejected so the user must review a fresh preview.

### Status presentation

Internal update codes remain stable for API and transaction decisions. The page
adds a presentation layer that collapses them into concise four-character user
states: `等待检查`, `已是最新`, `发现更新`, `等待接管`, `等待重建`, `用户链接`,
`只读来源`, and `状态异常`. Raw codes are never
replaced or used through translated labels.

Health is a separate dimension. A Skill row always keeps its update state and may
also show the highest related Doctor severity as `错误`, `警告`, or `提示`; the
complete issue list and all severity counts remain available in Skill detail and
the Health view. Library write access and source ownership are descriptive metadata,
not update or health states.

The overview derives source coverage, update readiness, source anomalies, missing
baselines, and provenance older than 180 days from the live installer lock. The
maintenance page also exposes preview-first transaction retention: each repair and
update type keeps its newest 10 records or anything from the last 30 days, while
the currently safe rollback remains protected regardless of age. Removed Catalog
transactions and unsupported legacy formats are marked obsolete. Cleanup rehashes
every candidate immediately before irreversible deletion.

The UI may persist additional scan roots in
`~/.agents/.ash/state/control-plane/ui-preferences.json`. These roots are not additional
managed libraries: ASH discovers and displays their top-level Skills but never
repairs, creates, restores, edits, or deletes content there. Cross-root duplicate
names are reported and every Skill detail retains its source identity.
An individual read-only Skill may be linked into the managed user library after
preview and confirmation. Apply revalidates the configured scan-root identity,
the complete source digest, and the empty destination before creating a top-level
symlink. It never copies or edits source content. The resulting `用户链接` entry can
be directly unlinked as the reverse operation; that removes only the managed
symlink, preserves the source, and creates no recovery record. A separate
`移入回收站` action keeps the previous recoverable-removal semantics for either
directories or links.
Top-level entries that resolve through symlinks to the same physical Skill are
collapsed into one record with multiple locations. Duplicate-name warnings are
reserved for different real paths, so a canonical Agents entry and its source
checkout do not create false drift.

Page-managed create, package, and snapshot operations reuse the existing core
implementations. They remain preview-first and revalidate source/output state at
apply time. Managed snapshots are stored below the control-plane state directory
and restore additively into the primary library only.

The page may update only the `description` field of a managed `SKILL.md`.
It preserves the remaining frontmatter and body, applies through the existing
file-write transaction mechanism, and is therefore covered by rollback hash
checks. Raw instruction editing and name/directory renames stay out of scope.

### Web-only source updates

Skill update is a page/API workflow and does not add a CLI command. The update
engine classifies every managed user Skill as installer-locked, repository-linked,
manual, or missing. Only real directories with a complete GitHub
v3 installer-lock entry and a standard 40-character Git tree SHA are eligible
for v1 writes. Empty, legacy, or 64-character fallback content hashes are shown
as non-comparable baselines instead of being misreported as updates.

Remote checks are explicit, grouped by source repository, and cached only in the
running UI service. A preview materializes the candidate in a temporary checkout,
validates `SKILL.md`, and reports added, changed, deleted, executable, and locally
preserved or discarded entries. `.env`, `.local`, and nested links are preserved;
`node_modules`, `__pycache__`, embedded `.git`, and other caches are discarded only
after explicit review. Apply requires the page session, one-time plan token, explicit
confirmation, fresh local/lock/upstream hashes, and a second candidate fetch.

The page can also establish this provenance for an unmanaged Skill from either an
exact `https://skills.sh/{owner}/{repository}/{skill}` identity or an HTTPS GitHub
repository plus repository-relative Skill path and optional ref. The page uses the
experimental, undocumented skills.sh search endpoint to discover exact-name
candidates in memory. Discovery never selects a candidate, creates a plan, clones a
repository, or writes local state; provider failure falls back to manual entry. The
user must choose a stable `owner/repository/skill` identity before the normal preview
and confirmation gates run. For an exact skills.sh identity ASH clones the encoded
GitHub repository and accepts only a unique matching `SKILL.md`; the resolver asks
Git only for slug-bounded paths so large repositories are not emitted wholesale,
and ambiguous layouts require an explicit GitHub path. A
baseline-missing Skill reuses its existing source. Both flows materialize and
validate the candidate before issuing a plan: if portable content already matches,
apply writes only the standard 40-character Git tree baseline; otherwise the plan
shows the same file-level adoption diff as an update. The source record, adopted
content, and previous lock state share the normal update transaction and rollback.
A source-locked Skill can also retarget its GitHub upstream to a different
repository or path. Retarget requires an explicit new skills.sh URL or GitHub
source, refuses the current identity, and uses the same preview, confirmation,
transaction, and rollback gates. `.env` and `.local` stay local. The completed
`retarget-source` transaction keeps the catalog identity for the new upstream.

The page presents acquisition and update provenance separately. `skills.sh` is the
takeover/catalog channel; GitHub is the code upstream used for checks and updates.
ASH keeps the exact catalog identity in its completed source-link transaction rather
than adding private fields to the shared v3 installer lock. The page uses that identity
only when the transaction still matches the current GitHub source, Skill path, and ref;
otherwise it truthfully falls back to `GitHub source`. External links are emitted only
after strict HTTPS host validation and point to the exact skills.sh page, GitHub
repository, and repository-relative `SKILL.md`.

Completed updates retain the previous Skill directory and lock file in a mode-0700
transaction below `state/control-plane/updates`. Rollback verifies the updated
Skill, installer lock, and preserved `.env`/`.local`/nested-link state before
restoring anything. Read-only scan roots, repository symlinks, and manual Skills
are never overwritten by this workflow.

## Recoverable page removal

Removal is a page/API feature backed by `lib/control-plane/removal.js`; it does
not add a CLI command. It is available only for top-level entries in the managed
user library. Preview records the complete entry digest, size, entry type, and
the target installer-lock entry. Apply rescans that state before writing.

Real directories are moved below `state/control-plane/removals/<transaction>`.
For a top-level symlink, the transaction moves only the link and never changes
the linked source directory. If a v3 installer-lock entry exists, only that
named entry is removed while unrelated concurrent lock entries are preserved.
Any apply failure attempts to restore both the managed entry and lock state.
The Maintenance page lists every valid recovery transaction with its removal
time, entry type, file count, and size. Any item can be restored after the
recovery content, empty destination, and lock entry are revalidated. Permanent
deletion is a separate one-time preview: it identifies exactly one transaction
directory, shows the target and size, requires the full Skill name, and hashes
the complete transaction directory again before deleting it. Delete-all builds
the same plans for the complete current recovery set, requires an exact phrase
such as `永久删除全部 4 个 Skill`, and invalidates the entire preview if any item is
added, restored, changed, or removed before confirmation. Removal
transactions join the normal retention policy, while the current restorable
transaction remains protected from automatic cleanup. Observe-only roots expose
scan-root management instead of per-Skill removal.

## Initialization and sync

`init` only creates the universal library when missing. ASH ships no bundled Skill
payload and never seeds, overwrites, or removes user-library content. The retired
`~/.ash/skills` tree is neither read nor migrated.

`sync` runs `git pull --ff-only` against the checkout's configured upstream only when ASH itself is a Git
checkout. For npm installs, users update ASH with npm. `sync` never uploads or
reconciles the user library.

## Packaging and snapshots

`.skill` packages and `.ash-snapshot` migrations are sourced exclusively from
top-level user Skills. Local-only content such as `.env`, `.git`, `.local`,
`node_modules`, Python bytecode, and nested symlinks is excluded.

Snapshot restore is dry-run-first and additive:

- missing user Skills are created;
- identical user Skills are unchanged;
- different same-name destinations are hard conflicts;
- extra destination Skills are reported by verify and never deleted;
- system, plugin, Store, and Agent-built-in Skills are never included.

## Configuration schema

Schema version 2 intentionally has no target list and no Codex Skill source roots.
Legacy target and Codex migration keys are rejected so obsolete behavior cannot
silently return through an old configuration file.

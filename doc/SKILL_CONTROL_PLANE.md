# ASH Skill Control Plane

## Goal

The control plane gives ASH one consistent view of Skills that are otherwise spread across personal libraries, Agent installers, Codex Store, Codex system bundles, plugins, and IDE-specific activation directories.

It answers four questions:

1. Which Skills exist and who owns them?
2. Which ASH Skills should be active in each detected target?
3. Where does actual state differ from desired state?
4. Which differences can be repaired deterministically and rolled back safely?

## Ownership model

| Source | Discovery | Control-plane authority |
| --- | --- | --- |
| ASH library | `~/.ash/skills/**/SKILL.md` | Manage links, catalog, and packages; never rewrite Skill instructions |
| Agents ecosystem | `~/.agents/.skill-lock.json` and `~/.agents/skills` | Observe only unless the Skill is ASH-owned |
| Codex Store | `.skills_store_lock.json` | Observe only |
| Codex system | `~/.codex/skills/.system` | Observe only |
| Codex plugins | `~/.codex/plugins/cache/**/skills` | Observe only |
| Unknown installs | Present on disk without an ownership record | Report only |

When ASH and another manager claim the same name, `doctor` reports `MULTIPLE_MANAGERS`; `repair` never chooses an owner automatically.

## Target activation

The default configuration always enables `~/.agents/skills` as the universal Agent target. Client-specific directories such as `~/.cursor/skills` and `~/.claude/skills` become active only when their parent client directory is detected.

This means every Skill does not have to live physically in `.agents/skills`. ASH keeps one source copy under `~/.ash/skills` and creates links only in the activation roots that need them.

Targets, inclusion lists, sources, and outputs are declared in `ash-control.json`. A target can be:

- `always`: always part of desired state;
- `detected`: active when its client root exists;
- `disabled`: excluded from reconciliation.

## Commands

```text
ash inventory                       unified asset view
ash doctor                          read-only health audit
ash repair                          safe dry-run plan
ash repair --apply                  execute the plan and record a transaction
ash rollback latest                 preview rollback
ash rollback latest --apply         apply rollback after full preflight
ash catalog --check|--write         verify or write the generated catalog
ash package <name>|--all            build deterministic .skill archives
```

`doctor` exit codes are:

- `0`: no errors or warnings;
- `1`: warnings require attention;
- `2`: configuration, metadata, or ownership conflicts exist.

Read-only control-plane commands do not trigger ASH first-run initialization.

## Repair transaction

`repair --apply` performs these steps:

1. Re-scan desired and actual state.
2. Reject ambiguous names and conflicting target paths.
3. Store new generated content and backups in `~/.ash/state/control-plane/transactions`.
4. Create missing target directories and ASH-owned links.
5. Atomically replace only broken links that still match the previewed target.
6. Update the generated catalog.
7. Persist progress after every operation.
8. Automatically roll back completed operations if a later operation fails.
9. Run a post-repair health audit.

Explicit rollback first validates every operation. If a link target or generated file changed after repair, rollback stops before restoring anything.

## Packaging

`.skill` archives use sorted paths, a fixed ZIP timestamp, deterministic compression, and preserved Unix file modes. Local-only files and directories such as `.env`, `.git`, `.local`, `node_modules`, and `__pycache__` are excluded.

## Implementation

The engine lives in `lib/control-plane` and uses Node.js standard-library modules only. Both `bin/ash` and `bin/ash.ps1` dispatch the same control-plane commands to `bin/ash-control.js`, keeping repair semantics identical across the existing Bash and PowerShell front ends.

The control plane deliberately does not:

- update third-party managers;
- delete unknown Skills;
- overwrite real files or directories;
- rewrite `SKILL.md` business instructions;
- mutate Codex Store, system, or plugin resources;
- force-resolve multiple-manager conflicts.

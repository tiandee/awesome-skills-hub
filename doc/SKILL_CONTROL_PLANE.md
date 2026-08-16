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
| Universal Agents library | `~/.agents/skills/**/SKILL.md` | Canonical Skill content; manage client links, catalog, and packages; never rewrite instructions |
| Agents installer metadata | `~/.agents/.skill-lock.json` | Observe provenance without duplicating library records |
| Codex Store user Skills | `.skills_store_lock.json` + install directory | Observe by default; optionally migrate into Agents and unregister transactionally |
| Codex system | `~/.codex/skills/.system` | Observe only |
| Codex plugins | `~/.codex/plugins/cache/**/skills` | Observe only |
| Unknown Codex-root installs | Present directly under `~/.codex/skills` without an ownership record | Report by default; optionally migrate into Agents |

When separately configured roots claim the same name, `doctor` reports `MULTIPLE_MANAGERS`; `repair` never chooses an owner automatically.

## Codex user Skill policy

The default project configuration sets `policies.codex_user_skills` to `migrate-to-agents`. With this policy, Store-installed and manually installed user Skills found under `~/.codex/skills` must become real directories in `~/.agents/skills`, using their declared frontmatter names. `doctor` reports drift and `repair` plans the migration; no read-only command moves content.

Migration removes the corresponding Store lock entry, preserves matching Agents aliases, updates client links and the generated catalog, and records every change in the repair transaction. Rollback restores both the original directory and Store metadata. A real directory, unrelated link, invalid Skill name, or duplicate owner at the destination is a hard conflict and is never overwritten.

Set the policy to `observe` to retain the previous read-only Store behavior. Codex `.system` Skills and plugin-cache Skills are always excluded because their lifecycle belongs to Codex or the plugin manager.

## Target activation

The default configuration uses `~/.agents/skills` as both the canonical universal library and the standard Agents activation root. Client-specific directories such as `~/.cursor/skills` and `~/.claude/skills` become active only when their parent client directory is detected.

The library accepts both real Skill directories and top-level symlinks to independently maintained source trees. The library itself cannot be configured as a reconciliation target, preventing self-links and accidental source deletion.

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

## Legacy migration

Mutating Bash and PowerShell commands detect legacy `~/.ash/skills`, recursively discover Skills, flatten category folders into the standard layout, copy only names missing from `~/.agents/skills`, and never overwrite an existing real directory or symlink. ASH then loads exclusively from the Agents library. Review same-name entries and links before moving the unused legacy directory to an archive.

## Repair transaction

`repair --apply` performs these steps:

1. Re-scan desired and actual state.
2. Reject ambiguous names, invalid Skill metadata, and conflicting target paths.
3. Store new generated content and backups in `~/.ash/state/control-plane/transactions`.
4. Migrate opted-in Codex user Skills and update their Store lock entries.
5. Create missing target directories and ASH-owned links.
6. Atomically replace only broken links that still match the previewed target.
7. Update the generated catalog.
8. Persist progress after every operation.
9. Automatically roll back completed operations if a later operation fails.
10. Run a post-repair health audit.

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
- mutate Codex system or plugin resources;
- mutate Codex Store resources unless `codex_user_skills` explicitly opts into migration;
- force-resolve multiple-manager conflicts.

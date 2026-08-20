# Contributing to Awesome Skills Hub

ASH manages top-level user Skills in `~/.agents/skills`. Contributions must keep
that single-root model and must not reintroduce per-Agent installation paths.

## Skill ownership

ASH does not bundle or publish Skill payloads. Do not add a project `skills/`
directory or code that seeds Skill content into the user library. User Skills are
created explicitly, restored from user snapshots, or adopted from an exact upstream
source through the page's preview-first workflow.

## Page-first maintenance and frozen CLI

The local management page and its loopback API are the primary product surface
for new interactive workflows. Add user-facing management features to
`lib/ui/service.js`, `lib/ui/server.js`, and the page before considering a new
CLI surface.

The v2 CLI command set is frozen. Change it only when one of these conditions is
met:

- the command is required to bootstrap or operate the local page;
- a headless automation workflow cannot use the page;
- compatibility, data safety, or a broken existing command requires a fix.

Do not add a CLI alias or parallel implementation for every page feature. When
both surfaces need a capability, implement it once in `lib/control-plane` and
keep CLI/API code as thin adapters.

## Change shared management behavior

- Keep all business logic in `lib/control-plane`; shell and PowerShell files are launchers only.
- Treat `~/.agents/skills` as the only Skill content root ASH manages.
- Keep read-only commands read-only, including on a fresh home directory.
- Make writes dry-run-first when they reconcile generated state.
- Never overwrite an existing user Skill or copy Agent-owned system/plugin Skills.
- Add focused tests and a real launcher-level acceptance path.
- Keep source-update checks and writes behind the web service; do not add an
  `ash update` command to the frozen CLI.
- Update writes must revalidate local content, installer-lock metadata, upstream
  folder hash, preserved local entries, and rollback state.

## Validate

```bash
npm test
npm pack --dry-run
```

Include the observed commands and results in the pull request description.

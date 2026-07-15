# Publish

Publish a selected Skill version as an installable package through a Workbench Cloud handle.

Use [Results](track.md) to confirm the current version and evidence before publishing. See [Install and clone](install-clone.md) for recipient handoff and [Visibility and Cloud](visibility-cloud.md) for visibility, sync, and hosted operations.

## Publish commands

Use `publish` to expose a package version through a Workbench Cloud handle:

```bash
workbench skill publish
workbench skill publish --private
workbench skill publish --team
workbench skill publish --public
workbench skill publish --as OWNER/SKILL
```

The default visibility is private. `--team` publishes an organization Skill when the project is linked to an organization namespace. `--public` exposes the package publicly.

Published handles use `OWNER/SKILL`. Installs can pin `OWNER/SKILL@VERSION` while that version remains published.

## Before publishing

Publish after the current version has enough evidence for the workflow risk. For many skills, that means a representative eval result, a source diff review, and no unresolved run failures that matter to users.

## Next steps

- [Install and clone](install-clone.md) explains recipient commands and editable Skill handoffs.
- [Visibility and Cloud](visibility-cloud.md) explains private, team, public, sync, unpublish, delete, and hosted operation behavior.

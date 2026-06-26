# Publish

Publish a selected skill version as installable source through a Workbench Cloud handle.

Use [Results](track.md) to confirm the current version and evidence before publishing. See [Install and clone](install-clone.md) for recipient handoff and [Visibility and Cloud](visibility-cloud.md) for visibility, sync, and hosted operations.

## Publish commands

Use `publish` to expose a package version through a Workbench Cloud handle:

```bash
workbench publish
workbench publish --private
workbench publish --team
workbench publish --public
workbench publish --as OWNER/SKILL
```

The default visibility is private. `--team` publishes an organization skill when the project is linked to an organization namespace. `--public` exposes installable public source.

Published handles use `OWNER/SKILL`. Installs can pin `OWNER/SKILL@VERSION` while that version remains published.

## Before publishing

Publish after the current version has enough evidence for the workflow risk. For many skills, that means a representative eval result, a source diff review, and no unresolved run failures that matter to users.

## Next steps

- [Install and clone](install-clone.md) explains recipient commands and editable source handoffs.
- [Visibility and Cloud](visibility-cloud.md) explains private, team, public, sync, unpublish, delete, and hosted operation behavior.

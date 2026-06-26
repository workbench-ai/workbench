# Visibility and Cloud

Use Workbench Cloud for source visibility, sync, unpublish and delete operations, login, and hosted execution.

See [Publish](share.md) for source publication and [Install and clone](install-clone.md) for recipient handoff.

## Login and auth

Sign in before running Workbench Cloud operations:

```bash
workbench login
workbench status
```

Provider-backed hosted operations also require provider auth for the relevant adapter. Publishing source and installing a package do not make hosted runs ready by themselves.

## Visibility

The default publish visibility is private:

```bash
workbench publish --private
workbench publish --team
workbench publish --public
```

`--team` publishes an organization skill when the project is linked to an organization namespace. `--public` exposes installable public source. Source visibility does not grant access to full project evidence.

## Sync, unpublish, and delete

Publishing and hosted commands sync what they need. Run explicit sync to repair state or move local evidence between environments:

```bash
workbench sync cloud
```

Use `unpublish` for one source version and `delete` for an entire Workbench Cloud skill project:

```bash
workbench unpublish VERSION
workbench delete OWNER/SKILL
```

Use `unpublish` to keep the skill in Cloud while removing one installable source version.

## Hosted operations

Add `--cloud` to run the operation in Workbench Cloud:

```bash
workbench run --cloud
workbench grade --cloud
workbench eval --cloud
workbench improve --cloud
```

Hosted compute requires Workbench Cloud login, hosted provider auth for provider-backed agents, and an organization-owned Cloud skill under an active Team or Enterprise plan.

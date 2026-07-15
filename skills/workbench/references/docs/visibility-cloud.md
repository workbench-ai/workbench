# Visibility and Cloud

Use Workbench Cloud for Skill visibility, sync, unpublish and delete operations, login, and hosted execution.

See [Publish](share.md) for package publication and [Install and clone](install-clone.md) for recipient handoff.

## Login and auth

Sign in before running Workbench Cloud operations:

```bash
workbench login
workbench skill show
```

Provider-backed hosted operations also require provider auth for the relevant adapter. Publishing or installing a package does not make hosted runs ready by itself.

## Visibility

The default publish visibility is private:

```bash
workbench skill publish --private
workbench skill publish --team
workbench skill publish --public
```

`--team` publishes an organization Skill when the project is linked to an organization namespace. `--public` exposes the package publicly. Skill visibility does not grant access to full project evidence.

## Sync, unpublish, and delete

Publishing and hosted commands sync what they need. Run explicit sync to repair state or move local evidence between environments:

```bash
workbench skill sync cloud
```

Use `unpublish` for one package version and `delete` for an entire Workbench Cloud Skill project:

```bash
workbench skill unpublish VERSION
workbench skill delete OWNER/SKILL
```

Use `unpublish` to keep the Skill in Cloud while removing one published package version.

## Hosted operations

Add `--cloud` to run the operation in Workbench Cloud:

```bash
workbench eval run --cloud
workbench eval grade --cloud
workbench skill improve --cloud
```

Hosted compute requires Workbench Cloud login, hosted provider auth for provider-backed agents, and an organization-owned Cloud skill under an active Team or Enterprise plan.

# Versions and lineage

Package versions capture the exact Skill package Workbench evaluated, improved, or published. Use lineage to compare a candidate with its base or restore a recorded version.

See [Review candidate changes](improve-review.md) for improved candidates and [Publish](share.md) for package publication.

## Package versions

Package versions are immutable Skill package snapshots. They are separate from Eval identity.

```bash
workbench skill versions
workbench skill diff <base-version-id>..<candidate-version-id>
workbench skill switch <version-id> --dry-run
workbench skill switch <version-id> --yes
```

`workbench skill versions` lists recorded package versions. `workbench skill diff` compares package files. `workbench skill switch --dry-run` previews the package files that would change. `workbench skill switch --yes` restores a recorded package version into the working folder without invoking Git after you have reviewed the preview.

## Lineage

Lineage records how versions relate to each other. Improvement creates a child candidate from evidence and records the proof path. Publishing exposes a fixed package version without erasing local lineage.

Use lineage to answer:

- Which version was the base.
- Which version was the candidate.
- Which run proved the candidate.
- Which version is currently restored in the working folder.

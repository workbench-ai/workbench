# Versions and lineage

Package versions capture the source Workbench evaluated, improved, or published. Use lineage to compare a candidate with its base or restore a recorded version.

See [Review candidate changes](improve-review.md) for improved candidates and [Publish](share.md) for source publication.

## Package versions

Package versions are skill source snapshots. They are separate from eval identity.

```bash
workbench log
workbench versions
workbench diff <base-version-id>..<candidate-version-id>
workbench switch <version-id>
```

`versions` lists recorded package versions. `diff` compares package files. `switch` restores a recorded package version into the working folder without invoking Git.

## Lineage

Lineage records how versions relate to each other. Improvement creates a child candidate from evidence and records the proof path. Publishing exposes a fixed package version without erasing local lineage.

Use lineage to answer:

- Which version was the base.
- Which version was the candidate.
- Which run proved the candidate.
- Which version is currently restored in the working folder.

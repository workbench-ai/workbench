# Skills

The public Workbench source ships one authored skill at `skills/workbench/`. It should stay thin and point agents at the canonical docs copied through the source export.

## Ownership

The Workbench skill owns agent ergonomics: deciding what skill to create or edit, turning conversations and traces into eval cases, drafting rubrics, choosing local command agents, configuring skill composition, running eval/improve loops, and explaining the evidence.

Workbench core owns durable substrate behavior: automatic source versions, skill bundle snapshots, eval snapshots, agent records, runs, traces, artifacts, lineage, object remotes, source publication, shared inspection, and operation capabilities.

Do not add core features for flows that can be encoded in a skill.

## Layout

- `SKILL.md`: agent-facing workflow.
- `agents/openai.yaml`: install metadata.
- `products/sample_skills/`: repo-local Workbench sample skills.
- `skill.assets.json`: docs copied into installed skill references.

## Validation

After changing the authored skill or copied docs, run:

```bash
pnpm --dir packages/cli test
pnpm build
pnpm test
```

Do not edit installed user-home skills directly. Refresh installed copies through the normal skill installer path after the source-backed export is updated.

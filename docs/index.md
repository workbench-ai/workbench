# Workbench Docs

Workbench turns [Agent Skills](https://agentskills.io/home) into evaluated, versioned workflows. Use it to create a skill, define representative eval cases, run and grade those cases with agents, improve from evidence, review results, and publish installable source.

## Choose A Path

| If you want to... | Read this |
| --- | --- |
| Try Workbench end to end | [Quickstart](quickstart.md) |
| See the common command paths | [Workflows](workflows.md) |
| Author cases, rubrics, agents, and runtime files | [Evals](evals.md) |
| Look up command behavior | [CLI Reference](cli.md) |
| Understand installable skill packages | [Skill Packages](skills.md) |
| Check the full product contract | [Spec](spec.md) |

## Core Concepts

| Concept | Meaning |
| --- | --- |
| Skill | A standards-compliant [Agent Skill](https://agentskills.io/specification) package with `SKILL.md` plus support files. |
| Eval | The quality bar for a workflow: cases, grading config, agents, and runtime environment source under `.workbench/`. |
| Run | Durable execution evidence: run state, internal jobs, traces, artifacts, result items, and score summaries. |
| Package version | The exact skill source Workbench evaluated, improved, or published. |
| Handle | A published identifier such as `acme/earnings-prep`, used for install and clone handoffs. |

## Daily Loop

```bash
workbench new ./earnings-prep
cd ./earnings-prep
workbench case draft investor-focus
workbench eval
workbench results
workbench improve
workbench publish
```

Start with [Quickstart](quickstart.md) for the first run. Use [Workflows](workflows.md) when you already know the job you need to finish.

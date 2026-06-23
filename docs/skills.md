# Skill Packages

Workbench works with standard [Agent Skills](https://agentskills.io/specification). A skill package is the installable source agents use: `SKILL.md` plus optional scripts, references, assets, `dist/**`, and support files.

Use this page when you want to understand the boundary between the installable skill package, Workbench eval controls, and the generated Workbench skill that helps agents operate the CLI.

Use the upstream [skill creator best practices](https://agentskills.io/skill-creation/best-practices) for general authoring guidance. Use Workbench when you need evals, evidence, versioning, improvement loops, publishing, and install/clone workflows around that package.

## What Workbench Adds

| Agent Skill package | Workbench project |
| --- | --- |
| `SKILL.md` instructions | `.workbench/eval.yaml` quality definition |
| `scripts/`, `references/`, `assets/` | `.workbench/cases/**` workflow cases |
| Installable package source | `.workbench/agents.yaml` agent matrix |
| Published package versions | Runs, internal jobs, traces, artifacts, and result evidence |

`workbench install` copies the Agent Skill package only. Workbench-published sources install with Workbench provenance; external sources delegate to `skills add` and remain ordinary Agent Skills with no Workbench version, eval, improve, publish, or clone behavior. `workbench clone` creates editable Workbench-published package source inside a fresh Workbench project.

## Generated Workbench Skill

The generated Workbench skill teaches coding agents how to create, evaluate, improve, publish, install, and clone Workbench-managed skills.

The skill stays intentionally thin. It loads copied reference docs for CLI syntax, workflows, eval source shape, and the product contract instead of duplicating those contracts in the prompt itself.

## Ownership Boundary

The Workbench skill owns the agent-operated workflow: deciding what skill to create or edit, turning conversations and traces into eval cases, drafting grade criteria, choosing local or hosted operation loops, configuring skill composition, running run/grade/eval/improve loops, and explaining the evidence.

Workbench core owns durable substrate behavior: automatic package versions, skill bundle snapshots, eval snapshots, agent records, operation graphs, runs, jobs, traces, artifacts, lineage, object remotes, source publication, shared inspection, and operation capabilities.

Do not add core features for flows that can be encoded in a skill.

Keep generated-skill changes in the authored source and refresh installed copies through the documented Workbench skill sync path. Do not edit installed user-home skill copies directly.

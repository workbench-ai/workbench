# Evals

Workbench evals answer one question: does this skill perform its intended workflow well enough to ship? You define that quality bar with eval source under `.workbench/**`; Workbench records versions, runs, internal jobs, traces, artifacts, scores, and lineage around it.

Use [Workflows](workflows.md) for the command paths that run this source. Use [CLI Reference](cli.md) when you need command details.

## Mental Model

| Layer | Files | Purpose |
| --- | --- | --- |
| Skill package | `SKILL.md`, `scripts/`, `references/`, `assets/`, `dist/**`, support files | Installable source that agents use. |
| Eval definition | `.workbench/eval.yaml` | Global grading adapter and shared criteria. |
| Cases | `.workbench/cases/<case-id>/case.yaml` | Inputs and case-specific grading overrides. |
| Agents | `.workbench/agents.yaml` | Agent and model matrix for runs. |
| Runtime | `.workbench/environment/Dockerfile` | Project-owned sandbox dependencies. |
| Local state | `.workbench/objects`, `.workbench/refs`, `.workbench/sync` | Generated evidence and sync metadata. |

Editing `.workbench/**` changes evaluation identity, not package identity. Editing files outside `.workbench/**` changes the package Workbench versions, evaluates, improves, and publishes.

## Starter Layout

```text
SKILL.md
.workbench/eval.yaml
.workbench/cases/
.workbench/agents.yaml
.workbench/environment/Dockerfile
.workbench/.gitignore
```

`workbench new` creates an empty `.workbench/cases/` directory. Add at least one case before running a real eval.

## Draft Cases

```bash
workbench case draft investor-focus
```

Cases live under `.workbench/cases/<case-id>`. Workbench intentionally keeps ordinary case authoring as file editing:

```text
.workbench/cases/investor-focus/case.yaml
.workbench/cases/investor-focus/tests/test.sh
```

Provider-backed case drafts need prompt and `grade.with.criteria` content before judgment evidence can be recorded. Local or command-backed drafts also need a top-level `command` in `case.yaml` or an executable `tests/test.sh`. Draft placeholders are launch gates: `run` requires the prompt placeholder to be replaced, while `grade` and `eval` also require draft grade criteria to be replaced.

The generated shell harness intentionally fails with score `0` until edited so local and command-backed projects do not accidentally record perfect draft evidence.

## Skill Instructions

```markdown
---
name: earnings-prep
description: Create an earnings prep note for a public company before earnings.
---

# Earnings Prep

Use this skill when the user asks for an earnings prep note before a public company reports.

## Inputs

- Company ticker or company name.
- Earnings date or quarter when available.
- Any user-provided investor focus areas.

## Workflow

1. Gather consensus expectations, recent business context, and known investor debates.
2. Identify likely focus areas, key questions, and watch items.
3. Separate supported facts from assumptions.

## Output

- A concise earnings prep note with expectations, context, questions, and watch items.

## Quality Bar

- Uses supported facts and avoids unsupported claims.
- Names the most decision-useful investor focus areas.
```

Keep the skill package self-contained. Workbench-published source follows the [Agent Skills package](https://agentskills.io/specification) shape, so `SKILL.md` should point to any scripts, references, or assets the agent needs.

## Global Grading

`.workbench/eval.yaml` defines the eval and shared grading config:

```yaml
version: 1
name: earnings-prep
description: Evaluates whether the skill creates a useful earnings prep note.
grade:
  adapter: rubric
  with:
    criteria:
      - id: accuracy
        description: Uses supported facts and avoids unsupported claims.
      - id: usefulness
        description: Produces a decision-useful earnings prep note.
```

Case criteria merge by stable `id`. A case criterion with the same id overrides the global criterion; a new id appends.

## Provider-Backed Cases

A provider-backed case can be prompt plus rubric criteria:

```yaml
version: 1
id: investor-focus
prompt: Create an earnings prep note for GOOGL.
grade:
  with:
    criteria:
      - id: investor-focus
        description: Explains the likely investor focus areas.
      - id: supported-facts
        description: Avoids claims not supported by the case context.
```

Use this shape when Codex or Claude should execute the workflow and a grader should judge the output.

## Local Or Command Cases

Local and command-backed cases add either a top-level `command` or an executable `tests/test.sh`:

```yaml
version: 1
id: deterministic-check
prompt: Create an earnings prep note for GOOGL.
command: sh "$CASE_DIR/tests/test.sh"
```

Shell tests write one public result file:

```sh
printf '{"ok":true,"score":1,"message":"passed"}\n' > "$OUTPUT_DIR/result.json"
```

`ok`, `passed`, or `pass` map to score `1` or `0` when no numeric `score` is present. If `$OUTPUT_DIR/result.json` exists, its pass/fail value is authoritative even when the shell exits `0`.

## Agents

`.workbench/agents.yaml` selects the default agent and optional comparison agents:

```yaml
default: default
agents:
  default:
    adapter: codex
    model: gpt-5.4-mini
    with:
      auth: default
```

Workbench passes provider `model` values through to the adapter. For Claude, use a Claude Code accepted alias such as `opus` or `sonnet`, or a full Claude Code model id.

## Authoring Loop

```bash
workbench new ./earnings-prep
cd ./earnings-prep
workbench case draft investor-focus
# edit .workbench/cases/investor-focus/case.yaml
workbench run --agents default --cases investor-focus
workbench grade --agents default --cases investor-focus
workbench eval --agents default -n 1
workbench results
```

Use `run` to inspect output before finalizing grade criteria. Use `grade` to judge existing execution evidence. Use `eval` when you want execute plus grade in one command.

## Turn Failures Into Cases

Good cases often come from observed misses, recent agent conversations, reviewer corrections, and traces. Inspect the evidence, then edit the case files:

```bash
workbench show RUN_ID
workbench show JOB_ID
workbench show RUN_ID:cases/investor-focus/output/result.json
```

`workbench improve` uses scored below-perfect, failed, or reviewed eval evidence. Perfect-only projects get a case-authoring remediation because there is no useful improvement signal yet.

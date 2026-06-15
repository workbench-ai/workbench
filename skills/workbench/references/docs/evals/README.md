# Eval Authoring

Workbench evals measure whether a skill performs its intended workflow. Keep the skill self-contained, then let Workbench persist automatic source versions, skill bundles, eval cases, agent comparisons, traces, readiness recommendations, and lineage. The job-level command sequences this authoring loop serves are defined in [`../jtbd.md`](../jtbd.md).

## Layout

```text
SKILL.md
.workbench/eval.yaml
.workbench/cases/
.workbench/agents.yaml
.workbench/.gitignore
.workbench/objects/
.workbench/refs/
.workbench/sync/
```

The runtime directories are ignored by Git. Authored Workbench source files such as `.workbench/eval.yaml`, cases, agents, optional skill composition, and optional custom environments are part of Workbench source versions. `.agents/` and `.workbench/remotes.yaml` are local machine metadata, not source.

## `SKILL.md`

```markdown
---
name: earnings-prep
description: Create an earnings prep note for a public company.
---

# Earnings Prep

Use this skill to create an earnings prep note that summarizes consensus expectations, recent business context, key questions, and watch items.
```

## `.workbench/eval.yaml`

```yaml
version: 1
name: earnings-prep
description: Measures whether the skill creates a useful earnings prep note.
score:
  adapter: tests
```

`workbench new` creates the eval definition and an empty `.workbench/cases/` directory. Add at least one case before running `workbench eval`; an eval with no cases fails with `no_eval_cases`.

Shell tests write one public result file:

```sh
printf '{"ok":true,"message":"passed"}\n' > "$OUTPUT_DIR/result.json"
```

`ok`, `passed`, or `pass` map to score `1` or `0` when no numeric `score` is provided. When `$OUTPUT_DIR/result.json` exists, its pass/fail value is authoritative: `{"ok":false,"score":0}` records failed scored evidence even if the shell exits `0`, and a failed shell test may also exit nonzero after writing the file. There is no second public result path.

## `.workbench/cases/case-001/case.yaml`

```yaml
version: 1
id: case-001
prompt: Create an earnings prep note for GOOGL.
rubric:
  - Explains the likely investor focus areas.
  - Uses concrete, decision-useful language.
  - Avoids overclaiming facts not present in the context.
```

## `.workbench/agents.yaml`

```yaml
default: default
agents:
  default:
    adapter: codex
    model: gpt-5.4-mini
    with:
      auth: default
```

Skill eval jobs support Docker-style command tests through `local` or `command` agents. Codex and Claude agents run the provider as the skill executor and score the same cases through the configured score adapter, such as `tests` or `rubric`, using adapter auth locally and in Workbench Cloud.

## Loop

```bash
workbench new ./earnings-prep
cd ./earnings-prep
# write .workbench/cases/case-001/case.yaml
workbench eval --agents default -n 1
workbench compare
workbench log --versions
workbench show current:SKILL.md
```

Use scored below-perfect, failed, or reviewed eval evidence for better cases and skill edits. `workbench improve` refuses to create cosmetic versions from perfect eval history or unscored runtime/auth failures, and the selected agent must have a skill-improvement adapter once actionable evidence exists. To create a regression case from a run, inspect it with `workbench show RUN_ID` and write the `.workbench/cases/*` files directly.

```bash
codex login --device-auth
workbench login codex --method oauth
workbench agent add default --adapter codex --model gpt-5.4-mini --with auth=default
workbench improve --agents default --budget 1 -n 1
workbench log --versions
workbench show <improved-version-id>:SKILL.md
```

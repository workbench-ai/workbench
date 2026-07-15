# Cases and grading

Cases define workflow inputs. Grading defines how case output becomes grade evidence.

[Evaluation basics](evals.md) explains the source model. [Agents and models](agents-models.md) explains the agent configuration that executes the cases.

## Draft cases

```bash
workbench eval case draft investor-focus
workbench eval case draft deterministic-check --grader tests
workbench eval case draft judgment-check --grader rubric
```

Cases live under `.workbench/cases/<case-id>`. Case authoring happens in files:

```text
.workbench/cases/investor-focus/case.yaml
.workbench/cases/investor-focus/tests/test.sh
```

`workbench eval case draft` inherits the eval default grader. New projects default to `none`, so a draft case is run-only until the case or eval selects `rubric`, `tests`, or `command`. Add `--grader rubric`, `--grader tests`, or `--grader command` when one case needs an exact grader. Rubric-backed drafts need a prompt and real criteria before Workbench can record judgment evidence. Tests-backed drafts include `tests/test.sh`, which must be edited into a real assertion harness. Command-backed drafts include a draft `grade.with.command`. Draft placeholders block launch until the required fields are filled: `eval run` requires a real prompt, while `eval grade` also requires real grader inputs for cases that have an effective concrete grader. Files left behind by an unselected grader are support files, not launch blockers.

The generated shell harness starts with score `0` until edited, so tests-backed projects do not record perfect draft evidence.

## Default grading

Define the default grader and shared grading config in `.workbench/eval.yaml`. New projects start with no eval-level grader:

```yaml
grade:
  adapter: none
```

`adapter: rubric` is one grading mode, not a top-level product object:

```yaml
grade:
  adapter: rubric
  with:
    judge:
      use: codex
    criteria:
      - id: accuracy
        description: Uses supported facts and avoids unsupported claims.
      - id: usefulness
        description: Produces a decision-useful earnings prep note.
```

Use `workbench eval grader` to inspect the current default and `workbench eval grader set ADAPTER` to write this policy from the CLI. The web `Evals > Cases` view exposes the same setting as `Default grader`.

Cases inherit this adapter when they omit `grade.adapter`. If the inherited adapter is `none`, the case runs without grade jobs. If a case sets the same adapter, case `grade.with` overlays the eval config. For rubric, criteria match by stable `id`: a case criterion with the same id overrides the global criterion and a new id appends. If a case sets a different adapter, the eval `grade.with` config is not inherited.

## Rubric-backed cases

A rubric-backed case can be just a prompt plus grading criteria:

```yaml
prompt: Create an earnings prep note for GOOGL.
grade:
  adapter: rubric
  with:
    judge:
      use: codex
    criteria:
      - id: investor-focus
        description: Explains the likely investor focus areas.
      - id: supported-facts
        description: Avoids claims not supported by the case context.
```

Use this shape when an agent executes the task and a separately configured, tool-capable judge inspects the output. Rubric runs one judge turn for all criteria so artifact inspection is shared and the scorecard stays coherent. Omit `adapter: rubric` only when the eval default is already rubric; an explicit effective `judge` is always required.

## Tests-backed cases

Tests-backed cases add an executable `tests/test.sh`:

```yaml
prompt: Create an earnings prep note for GOOGL.
grade:
  adapter: tests
```

Shell tests write a public result file:

```sh
printf '{"ok":true,"score":1,"message":"passed"}\n' > "$OUTPUT_DIR/result.json"
```

`ok`, `passed`, or `pass` map to score `1` or `0` when no numeric `score` is present. If `$OUTPUT_DIR/result.json` exists, its pass/fail value is authoritative even when the shell exits `0`.

Omit `adapter: tests` only when the eval default is already tests. In a default `none` eval, a tests-backed case must set `grade.adapter: tests`.

## Command-backed cases

Command-backed cases store the command in `case.yaml`:

```yaml
prompt: Create an earnings prep note for GOOGL.
grade:
  adapter: command
  with:
    command: sh "$CASE_DIR/tests/test.sh"
```

Use command-backed cases when the grader can be expressed as a shell command that exits and writes normalized grade evidence. Prefer `tests` for normal case-owned shell assertions because it gives the web and CLI a file editor for `tests/test.sh`.

## Case quality

Good cases often come from misses, recent agent conversations, reviewer corrections, and traces. Inspect the evidence, then edit the case files:

```bash
workbench eval show RUN_ID
workbench eval show JOB_ID
workbench eval show RUN_ID:cases/investor-focus/output/result.json
```

Prefer a small number of decision-useful cases over many vague prompts. When an eval is perfect but the skill is still weak, add sharper cases or stricter grading criteria before improving source.

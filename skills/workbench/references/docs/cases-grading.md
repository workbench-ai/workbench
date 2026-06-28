# Cases and grading

Cases define workflow inputs. Grading defines how case output becomes grade evidence.

[Evaluation basics](evals.md) explains the source model. [Agents and models](agents-models.md) explains the agent configuration that executes the cases.

## Draft cases

```bash
workbench case draft investor-focus
```

Cases live under `.workbench/cases/<case-id>`. Case authoring happens in files:

```text
.workbench/cases/investor-focus/case.yaml
.workbench/cases/investor-focus/tests/test.sh
```

Provider-backed drafts need a prompt and `grade.with.criteria` before Workbench can record judgment evidence. Local or command-backed drafts also need a top-level `command` in `case.yaml` or an executable `tests/test.sh`. Draft placeholders block launch until the required fields are filled: `run` requires a real prompt, while `grade` and `eval` also require real grading criteria.

The generated shell harness starts with score `0` until edited, so local and command-backed projects do not record perfect draft evidence.

## Global grading

Define shared grading config in `.workbench/eval.yaml`. `adapter: rubric` is one grading mode, not a top-level product object:

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

Criteria match by stable `id`. A case criterion with the same id overrides the global criterion; a new id appends.

## Provider-backed cases

A provider-backed case can be just a prompt plus grading criteria:

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

Use this shape when Codex or Claude executes the task and a grader judges the output.

## Local or command cases

Local and command-backed cases add a top-level `command` or an executable `tests/test.sh`:

```yaml
version: 1
id: deterministic-check
prompt: Create an earnings prep note for GOOGL.
command: sh "$CASE_DIR/tests/test.sh"
```

Shell tests write a public result file:

```sh
printf '{"ok":true,"score":1,"message":"passed"}\n' > "$OUTPUT_DIR/result.json"
```

`ok`, `passed`, or `pass` map to score `1` or `0` when no numeric `score` is present. If `$OUTPUT_DIR/result.json` exists, its pass/fail value is authoritative even when the shell exits `0`.

## Case quality

Good cases often come from misses, recent agent conversations, reviewer corrections, and traces. Inspect the evidence, then edit the case files:

```bash
workbench show RUN_ID
workbench show JOB_ID
workbench show RUN_ID:cases/investor-focus/output/result.json
```

Prefer a small number of decision-useful cases over many vague prompts. When an eval is perfect but the skill is still weak, add sharper cases or stricter grading criteria before improving source.

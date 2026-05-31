# Workbench Eval Authoring

This directory is the canonical guide for creating Workbench evaluations. Use it when you need a new `benchmark.yaml`, candidate manifests such as `candidates/codex/candidate.yaml`, candidate files under `candidates/codex/files/`, candidate-owned improve settings, an external Harbor engine adapter source, or a workflow that scores files such as `.docx`, `.xlsx`, `.pdf`, or `.pptx`.

Workbench authoring has two public primitives. The engine is selected in `benchmark.yaml` and owns benchmark runtime behavior. The candidate is the mutable thing Workbench evaluates or improves, and its manifest owns files, prepare commands, runnable variants, default run, and optional improve settings. For native Workbench evals, use `version: 4` plus `engine.use: workbench`; that engine owns `environment`, optional task path selection, and the `score` adapter slot under `engine.with`. Omitted `engine.with.tasks` defaults to `tasks/`. Harbor task directories are handled by an external engine adapter selected with `engine.use: harbor`. Do not make evaluator code the candidate unless the evaluator itself is the product being improved.

Workbench eval authoring has two normal starting points:

- Existing workflow: start with [from-existing-workflow.md](from-existing-workflow.md) when there is already a script, test command, benchmark suite, Harbor task set, or manual scoring process.
- File-output cases: start with [from-file-outputs.md](from-file-outputs.md) when case inputs, outputs, examples, goldens, reports, workbooks, decks, PDFs, or other opaque files affect runtime prerequisites.

Before writing a spec, read:

- [spec-syntax.md](spec-syntax.md) for the version-4 benchmark/candidate shape.
- [runner-contract.md](runner-contract.md) for engine staging, evidence visibility, same-environment scoring, and result outputs.
- [adapters.md](adapters.md) for custom adapter manifests, sources, overrides, auth, slots, engine-owned helpers, and local replay.
- [tasks-and-fixtures.md](tasks-and-fixtures.md) for task directory layout, public files, verifier tests, and Harbor imports.
- [run-and-inspect.md](run-and-inspect.md) for local smoke runs, remote execution, remote URLs, and inspection.

File-specific guidance lives under [file-recipes/](file-recipes/):

- [docx.md](file-recipes/docx.md)
- [xlsx.md](file-recipes/xlsx.md)
- [pdf.md](file-recipes/pdf.md)
- [pptx.md](file-recipes/pptx.md)

The authoring goal is not to make a perfect evaluator on the first pass. First make a small smoke eval that proves the selected engine can stage the candidate, run it on a case, keep verifier files private until scoring, write a finite numeric score, and produce inspectable artifacts. For the built-in `workbench` engine, default to rubric scoring for qualitative behavior; use tests or command scoring only for deterministic checks or an existing scoring workflow. Rubric scoring runs one judge turn per criterion, and `score.with.parallelism` is the single throttle for those criterion turns.

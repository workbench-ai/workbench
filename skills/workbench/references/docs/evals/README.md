# Workbench Eval Authoring

This directory is the canonical guide for creating Workbench evaluations. Use it when you need a new `benchmark.yaml`, subject manifests such as `subjects/claude/subject.yaml`, subject files under `subjects/claude/files/`, optimizer YAML files such as `optimizers/claude.yaml`, a Harbor task adapter import, or a workflow that scores files such as `.docx`, `.xlsx`, `.pdf`, or `.pptx`.

The subject is the mutable thing Workbench evaluates or improves. Benchmarks live in `benchmark.yaml` plus tasks; subject manifests select how to run the subject; subject files live in the sibling `files/` directory; optimizer YAML selects edit paths and improve behavior for `workbench improve --optimizer optimizers/foo.yaml` runs. Do not make evaluator code the subject unless the evaluator itself is the product being improved.

Workbench eval authoring has two normal starting points:

- Existing workflow: start with [from-existing-workflow.md](from-existing-workflow.md) when there is already a script, test command, benchmark suite, Harbor task set, or manual scoring process.
- File-output tasks: start with [from-file-outputs.md](from-file-outputs.md) when tasks, outputs, examples, goldens, reports, workbooks, decks, PDFs, or other opaque files affect runtime prerequisites.

Before writing a spec, read:

- [spec-syntax.md](spec-syntax.md) for the version-2 split benchmark/subject/optimizer YAML shape.
- [runner-contract.md](runner-contract.md) for trial staging, phase visibility, same-environment scoring, and scorecard outputs.
- [adapters.md](adapters.md) for custom adapter manifests, sources, overrides, auth, nested refs, task-source adapters, and local replay.
- [tasks-and-fixtures.md](tasks-and-fixtures.md) for task directory layout, public files, verifier tests, and Harbor imports.
- [run-and-inspect.md](run-and-inspect.md) for the local and hosted CLI loop.

File-specific guidance lives under [file-recipes/](file-recipes/):

- [docx.md](file-recipes/docx.md)
- [xlsx.md](file-recipes/xlsx.md)
- [pdf.md](file-recipes/pdf.md)
- [pptx.md](file-recipes/pptx.md)

The authoring goal is not to make a perfect evaluator on the first pass. First make a small smoke eval that proves Workbench can stage the subject, run it on a task, keep verifier files private until scoring, write a finite numeric score, and produce inspectable artifacts. Default to rubric scoring for qualitative behavior; use tests or command scoring only for deterministic checks or an existing scorer.

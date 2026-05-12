# Adapter Authoring

Adapters let a Workbench project choose operations that improve a subject, run a subject in a trial, score a trial, or resolve tasks from another source. An adapter is a source directory or package with `workbench.adapter.yaml` plus operation commands. There is no adapter daemon or SDK requirement.

A complete minimal package lives at `examples/adapters/echo` in the Workbench source tree. It includes optional env auth, a typed adapter slot, and a request fixture for `workbench adapters test`.

## Manifest

```yaml
id: my-agent
protocol: workbench.adapter.v2
setup:
  - npm install --global .
operations:
  subject.run:
    command: workbench-adapter-my-agent
  subject.improve:
    command: workbench-adapter-my-agent
```

`id` is the name used by `run.use`, `score.use`, `improve.use`, or a task-source invocation such as `tasks: { use: my-source, with: ... }`. It must be lowercase and may contain numbers and hyphens. `protocol` must be `workbench.adapter.v2`. `operations` declares the operation names this adapter implements. Each operation may name its command; if omitted, Workbench uses `workbench-adapter-<id>`. `setup` is a list of Dockerfile `RUN` commands appended after the benchmark Dockerfile when Workbench builds the runtime image.

Workbench rejects unknown manifest keys. Keep adapter-specific settings under the YAML invocation's `with` object, not in the manifest.

## Sources

Project YAML can declare adapter sources in `benchmark.yaml`, `subject.yaml`, or `optimizer.yaml`:

```yaml
adapters:
  - ../../adapters/my-agent
  - npm:@acme/workbench-adapter@1.2.3
  - git:https://github.com/acme/workbench-adapter.git#4f2c1a9
```

Path sources must stay inside the benchmark source tree. `npm:` and `git:` sources are resolved during local source reading and hosted publication. Exact npm versions and git commits are pinned; npm tags, git branches, and default branches float.

Built-in ids are `path` and `harbor` for `tasks.resolve`, `codex`, `claude`, and `pi` for `subject.run` and `subject.improve`, and `tests` and `rubric` for `trial.score`. A project-declared source whose manifest has one of those ids intentionally overrides that built-in for the project. This is also the wrapping mechanism: write an adapter with the built-in id and have its operation commands delegate to whatever tool or package you want. Workbench does not implicitly install or run the displaced built-in, because hidden setup would make runtime behavior harder to audit. `workbench adapters list`, `workbench adapters inspect`, and `workbench check` report the override.

## Runtime Request

Adapter commands receive three environment variables:

- `WORKBENCH_ADAPTER_REQUEST`: path to a JSON request matching `workbench.adapter.v2`.
- `WORKBENCH_OUTPUT`: writable output directory, normally `/workspace/output`.
- `WORKBENCH_RESULT`: expected result-file path, normally `/workspace/output/workbench-result.json`.

The request includes `operation`, `invocation.use`, `invocation.with`, optional scoped auth material, benchmark/subject/task context, and staged filesystem paths. Adapter commands should ignore request fields they do not understand.

Every operation writes one result file at `paths.result`, normally `/workspace/output/workbench-result.json`, with protocol `workbench.adapter-result.v1`:

```json
{
  "protocol": "workbench.adapter-result.v1",
  "operation": "trial.score",
  "ok": true,
  "value": {
    "score": 1,
    "summary": "Passed"
  }
}
```

Result values are operation-specific: `tasks.resolve` returns `{ "tasks": [...] }` plus optional environment defaults, `subject.run` returns `null` or omits `value`, `trial.score` returns a Workbench scorecard, and `subject.improve` returns a subject patch. Top-level `summary`, `feedback`, and `usage` on the result file carry adapter metadata.

## TypeScript Helper

TypeScript adapters can use the protocol package as a tiny handler runtime. This is optional; raw adapters may still read and write the JSON files directly.

```ts
import {
  defineAdapter,
  defineScorer,
  runDefinedAdapter,
} from "@workbench-ai/workbench-protocol";

const adapter = defineAdapter({
  id: "my-scorer",
  score: defineScorer({
    handle(ctx) {
      return ctx.result({
        score: 1,
        summary: `Scored ${ctx.request.context?.trial?.caseId ?? "current"}.`,
      });
    },
  }),
});

await runDefinedAdapter(adapter);
```

The handler context exposes `ctx.request`, `ctx.with`, `ctx.paths`, `ctx.slot(name)`, and `ctx.result(value, metadata)`. `ctx.slot(name)` reads a typed slot from the adapter invocation's `with` object.

## Command Adapter

The built-in `command` adapter is a shell bridge. For `subject.run`, the command may just mutate the working directory; Workbench publishes an ok result if the command does not. For `subject.improve`, the command may either write `workbench-result.json` itself or mutate editable subject files in the current working directory so the adapter can derive a subject patch.

For `trial.score`, the command must write `workbench-result.json` with `operation: "trial.score"` and a scorecard value containing a finite numeric `score`. A scorer command that exits successfully without that result fails at the adapter boundary.

## Task-Source Adapters

Task-source adapters implement `tasks.resolve` and resolve task collections into `TaskBundle` records. A `TaskBundle` is the structured task object consumed by trial planning: task id, task text, public files, verifier-only files, optional oracle files, and optional task environment defaults. Task-source adapters run at source-load time through the same adapter request protocol, not inside the trial sandbox.

If `benchmark.tasks` is omitted, Workbench uses the built-in `path` task-source adapter with `with.path: tasks`. Explicit task sources are selected from `benchmark.yaml` with the same invocation shape:

```yaml
tasks:
  use: harbor
  with:
    path: ../terminal-bench-subset
```

The canonical explicit native path form is:

```yaml
tasks:
  use: path
  with:
    path: tasks
```

The output boundary is `workbench-result.json` with `operation: "tasks.resolve"` and a `value` containing structured `TaskBundle` data plus optional task-source environment defaults. The built-in `path` adapter parses native Workbench task directories. The built-in `harbor` adapter reads Harbor `instruction.md`, `task.toml`, `environment/`, `tests/`, and `solution/`. Core runtime remains generic and executes the resulting bundles through the normal trial lifecycle.

## Auth

Adapters declare auth in the manifest. Top-level `auth.methods` applies to the adapter itself. `auth.slots` declares named nested auth targets, such as a deploy token plus a model token. Methods can collect environment variables, profile files, or a local command that prints the bundle JSON.

Users connect auth with:

```bash
workbench auth connect my-agent --method api-key
workbench auth connect deployer/github --method token-file
```

Workbench injects only the auth required by the adapter invocation being executed. Hosted workers receive scoped adapter auth material, not user home directories or service credentials.

## Adapter Slots

Slots are typed pointers into an invocation's `with` object:

```yaml
id: orchestrator
protocol: workbench.adapter.v2
setup: []
operations:
  trial.score:
    command: workbench-adapter-orchestrator
slots:
  judge:
    path: /judge
    operation: subject.run
```

If `score.with.judge.use` points at another adapter, the `judge` slot tells Workbench to discover that nested adapter, include its source, apply default auth profiles, and validate that it implements `subject.run`. Workbench does not automatically execute the child adapter. The parent adapter owns any delegation protocol, subprocess call, or API call it wants to make.

The built-in `rubric` adapter uses this pattern for its `judge` setting.

## Local Validation

Create a starter adapter:

```bash
workbench adapters create adapters/my-agent
```

Validate only the manifest:

```bash
workbench adapters test adapters/my-agent
```

Replay a request fixture locally:

```bash
workbench adapters test adapters/my-agent --request adapter-request.json --output out/adapter-test
```

When `--request` is provided, Workbench parses the request, checks that `invocation.use` matches the manifest id, runs the requested operation command with `WORKBENCH_ADAPTER_REQUEST` and `WORKBENCH_OUTPUT`, and verifies `workbench-result.json`. Use `--output` when you want a stable local output directory; otherwise Workbench creates a temporary output directory and reports it in command output. This is a local command replay; it does not start Docker or a hosted run.

## Protocol Versioning

`workbench.adapter.v2` is the current adapter request and manifest protocol string. `workbench.adapter-result.v1` is the current result protocol string. Required request fields, operation result values, and manifest meaning belong to those protocol strings.

Adapter manifests are strict so authors catch misspelled fields early. Adapter request JSON allows optional context fields so Workbench can expose more runtime information without adding YAML surface.

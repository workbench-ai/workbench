# Adapter Authoring

Adapters let a Workbench project provide public engine, subject, or optimizer behavior, plus Workbench-engine helper behavior selected inside `engine.with`. An adapter is a source directory or package with `workbench.adapter.yaml` plus operation commands. There is no adapter daemon or SDK requirement.

A complete minimal package lives at `examples/adapters/echo` in the Workbench source tree. It includes optional env auth, a typed adapter slot, and a request fixture for `workbench adapters test`.

## Manifest

```yaml
id: my-agent
protocol: workbench.adapter.v3
setup:
  - npm install --global .
operations:
  subject.run:
    command: workbench-adapter-my-agent
  optimizer.improve:
    command: workbench-adapter-my-agent
```

`id` is the name used by `engine.use`, `run.use`, `improve.use`, or an engine-owned nested invocation such as `engine.with.score.use`. It must be lowercase and may contain numbers and hyphens. `protocol` must be `workbench.adapter.v3`. `operations` declares the operation names this adapter implements. Each operation may name its command; if omitted, Workbench uses `workbench-adapter-<id>`. Each operation may also set `executor: sandbox | host`; missing values default to `sandbox`. A `host` operation runs only the adapter controller in the trusted local or Cloud worker process and does not run subject prepare first. Host controllers receive `WORKBENCH_RUNTIME_CONTROL_URL` and `WORKBENCH_RUNTIME_CONTROL_TOKEN`; they can use the generic runtime-control operation-sequence endpoint to create child operation sequences without core knowing about runners, graders, Harbor, or Workbench-native tasks. Benchmark-contained host adapters run from their adapter source root with `WORKBENCH_ADAPTER_ROOT` set, so relative commands such as `node adapter.mjs` are portable. `setup` is a list of Dockerfile `RUN` commands appended after the engine Dockerfile when Workbench builds the runtime image for sandbox-executor operations.

Workbench rejects unknown manifest keys. Keep adapter-specific settings under the YAML invocation's `with` object, not in the manifest.

## Sources

Project YAML can declare adapter sources in `benchmark.yaml`, `subject.yaml`, or `optimizer.yaml`:

```yaml
adapters:
  - adapters/my-agent
  - npm:@acme/workbench-adapter@1.2.3
  - git:https://github.com/acme/workbench-adapter.git#4f2c1a9
```

Path sources must stay inside the benchmark source tree. `npm:` and `git:` sources are resolved during local source reading and hosted publication. Exact npm versions and git commits are pinned; npm tags, git branches, and default branches float.

The CLI default adapter catalog includes `workbench` for the native engine and `codex`, `claude`, and `command` for subject, optimizer, or command-backed engine behavior. The built-in Workbench engine owns native task loading plus the `tests` and `rubric` scoring helpers selected only inside `engine.with.score`; they are not additional public adapter categories or top-level authoring primitives.

Harbor interop is supplied by an external engine adapter package selected with `engine.use: harbor`. A project-declared source whose manifest id matches a default catalog adapter id intentionally overrides that default for the project. A project-declared source whose manifest id matches a Workbench-engine scoring helper id is available only where that helper is selected inside the built-in `workbench` engine config. These are also the wrapping mechanisms: write an adapter with the id you want to replace and have its operation commands delegate to whatever tool or package you want. Workbench does not implicitly install or run the displaced default adapter or helper, because hidden setup would make runtime behavior harder to audit. `workbench adapters list`, `workbench adapters inspect`, and `workbench check` report the override.

## Runtime Request

Adapter commands receive three environment variables:

- `WORKBENCH_ADAPTER_REQUEST`: path to a JSON request matching `workbench.adapter.v3`.
- `WORKBENCH_OUTPUT`: writable output directory, normally `/workspace/output`.
- `WORKBENCH_RESULT`: expected result-file path, normally `/workspace/output/workbench-result.json`.

The request includes `operation`, `invocation.use`, `invocation.with`, optional scoped auth material, benchmark/subject/case context, and staged filesystem paths. Adapter commands should use the documented `request.paths` entries instead of assuming fixed mounts. The usual runtime paths are `/workspace` for the mutable working directory, `/workspace/input/subject` for the immutable subject baseline, `/workspace/input/case` for public case files, `/workspace/input/traces` for prior optimizer traces, `/workspace/private/engine` for engine-only verifier material, and `/workspace/output` for durable results, artifacts, and traces. Host-executor operations receive the same request and result contract, but the adapter command runs in the trusted process instead of a Workbench-created sandbox. The built-in Workbench engine passes `paths.case` to nested subject adapters and withholds `paths.enginePrivate`.

Every operation writes one result file at `paths.result`, normally `/workspace/output/workbench-result.json`, with protocol `workbench.adapter-result.v1`:

```json
{
  "protocol": "workbench.adapter-result.v1",
  "operation": "engine.run",
  "ok": true,
  "value": {
    "score": 1,
    "summary": "Passed"
  }
}
```

Result values are operation-specific protocol details: `subject.run` returns `null` or omits `value`, `engine.run` returns a Workbench result record for the built-in Workbench engine, and `optimizer.improve` returns a subject patch. Top-level `summary`, `feedback`, and `usage` on the result file carry adapter metadata.

## TypeScript Helper

TypeScript adapters can use the protocol package as a tiny handler runtime. This is optional; raw adapters may still read and write the JSON files directly.

```ts
import {
  defineAdapter,
  defineEngineRunner,
  runDefinedAdapter,
} from "@workbench-ai/workbench-protocol";

const adapter = defineAdapter({
  id: "my-engine-helper",
  engineRun: defineEngineRunner({
    handle(ctx) {
      return ctx.result({
        score: 1,
        summary: `Ran ${ctx.request.context?.attempt?.caseId ?? "current"}.`,
      });
    },
  }),
});

await runDefinedAdapter(adapter);
```

The handler context exposes `ctx.request`, `ctx.with`, `ctx.paths`, `ctx.slot(name)`, and `ctx.result(value, metadata)`. `ctx.slot(name)` reads a typed slot from the adapter invocation's `with` object.

## Command Adapter

The built-in `command` adapter is a shell bridge. For `subject.run`, the command may just mutate `paths.workspace`; Workbench publishes an ok result if the command does not. For `optimizer.improve`, the command may either write `workbench-result.json` itself or mutate editable subject files in `paths.workspace` so the adapter can derive a subject patch.

When the built-in `workbench` engine uses a command as a scoring helper, the command must write `workbench-result.json` with a result value containing a finite numeric `score`. A scoring command that exits successfully without that result fails at the adapter boundary.

## Engine-Owned Helpers

The built-in `workbench` engine owns native task loading and scoring. Native task directories are configured under `engine.with.tasks`, and scoring is configured through the engine's `score` adapter slot at `engine.with.score`. Slot targets such as `tests` and `rubric` may use the adapter protocol internally, but they are not core adapter categories.

If `engine.with.tasks` is omitted, the built-in `workbench` engine reads `tasks/`. The explicit native path form is:

```yaml
engine:
  use: workbench
  with:
    tasks:
      path: alternate-tasks
```

Native scoring is selected inside the same engine config:

```yaml
engine:
  use: workbench
  with:
    score:
      use: rubric
      with:
        parallelism: 2
```

Native task loading plus the `tests` and `rubric` scoring helpers are owned by the built-in `workbench` engine. The rubric helper runs one judge adapter turn per criterion and owns `score.with.parallelism` as the single configurable throttle for those criterion turns; core runtime still sees one generic engine result. Harbor is selected as an external engine adapter:

```yaml
engine:
  use: harbor
  with:
    path: terminal-bench-subset
```

The Harbor engine adapter should stay a thin bridge to Harbor. Harbor itself owns `instruction.md`, `task.toml`, `environment/`, `tests/`, health-check, MCP-server, and `solution/` interpretation, subject invocation, artifact handoff, verifier/reward behavior, and same-sandbox versus separate-sandbox verifier topology. Core runtime remains generic and records the engine's normalized job result, trace sessions, trace files, and artifacts. Host engine adapters use runtime-control when they want Workbench to allocate child sandboxes; TypeScript adapters can call `runWorkbenchRuntimeOperationSequence` from `@workbench-ai/workbench-protocol`, and raw adapters can call the bearer-protected HTTP endpoint directly. A Harbor adapter should call Harbor inspect/export and run APIs, expose Workbench runtime-control as a sandbox provider when Harbor asks for sandboxes, and normalize the final Harbor result instead of reimplementing Harbor `task.toml` semantics in Workbench code. Use benchmark-contained paths for portable Cloud runs; if an engine reads outside the benchmark tree, its `engine.resolve` operation must emit inspectable resolved files. Hosted pushes upload resolved cases plus an `engineResolveBinding` so Cloud can verify the snapshot belongs to the selected resolver without re-running engine-specific logic.

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
protocol: workbench.adapter.v3
setup: []
operations:
  engine.run:
    command: workbench-adapter-orchestrator
slots:
  judge:
    path: /judge
    operation: subject.run
```

If `score.with.judge.use` points at another adapter, the `judge` slot tells Workbench to discover that nested adapter, include its source, apply default auth profiles, and validate that it implements `subject.run`. Workbench does not automatically execute the child adapter. The parent adapter owns any delegation protocol, subprocess call, or API call it wants to make.

The built-in `rubric` adapter uses this pattern for its `judge` setting. It expands configured criteria into separate judge turns and applies its own `parallelism` setting when scheduling those turns. Those criterion turns remain Workbench-engine internals; the helper publishes each selected judge trace as a trace session plus scorecard/result files under the parent engine job's trace/artifact bundle instead of creating core grader jobs.

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

`workbench.adapter.v3` is the current adapter request and manifest protocol string. `workbench.adapter-result.v1` is the current result protocol string. Required request fields, operation result values, and manifest meaning belong to those protocol strings.

Adapter manifests are strict so authors catch misspelled fields early. Adapter request JSON allows optional context fields so Workbench can expose more runtime information without adding YAML surface.

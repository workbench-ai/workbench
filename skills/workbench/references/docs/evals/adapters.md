# Adapter Authoring

Adapters let a Workbench project choose the command that improves a candidate, runs a task, or grades runner output. An adapter is just a source directory or package with `workbench.adapter.yaml` plus the executable command named by that manifest. There is no adapter daemon or SDK requirement.

A complete minimal package lives at `examples/adapters/echo` in the Workbench source tree. It includes optional env auth, a nested `refs` declaration, and a request fixture for `workbench adapters test`.

## Manifest

```yaml
id: my-agent
protocol: workbench.adapter.v1
setup:
  - npm install --global .
command: workbench-adapter-my-agent
```

`id` is the name used by `improve.use`, `run.use`, or `grade.use`. It must be lowercase and may contain numbers and hyphens. `protocol` must be `workbench.adapter.v1`. `setup` is a list of Dockerfile `RUN` commands appended after the benchmark Dockerfile when Workbench builds the runtime image. `command` is executed inside the runtime image for each phase. If `command` is omitted, Workbench uses `workbench-adapter-<id>`.

Workbench rejects unknown manifest keys. Keep adapter-specific settings under the YAML invocation's `with` object, not in the manifest.

## Sources

Project YAML can declare adapter sources in `benchmark.yaml`, `candidate.yaml`, or `optimizer.yaml`:

```yaml
adapters:
  - ../../adapters/my-agent
  - npm:@acme/workbench-adapter@1.2.3
  - git:https://github.com/acme/workbench-adapter.git#4f2c1a9
```

Path sources must stay inside the benchmark source tree. `npm:` and `git:` sources are resolved during local source reading and hosted publication. Exact npm versions and git commits are pinned; npm tags, git branches, and default branches float.

Built-in ids are `codex`, `claude`, `pi`, `command`, and `rubric`. A project-declared source whose manifest has one of those ids intentionally overrides that built-in for the project. This is also the wrapping mechanism: write an adapter with the built-in id and have its command delegate to whatever tool or package you want. Workbench does not implicitly install or run the displaced built-in, because hidden setup would make runtime behavior harder to audit. `workbench adapters list`, `workbench adapters inspect`, and `workbench check` report the override.

## Runtime Request

Adapter commands receive two environment variables:

- `WORKBENCH_ADAPTER_REQUEST`: path to a JSON request matching `workbench.adapter.v1`.
- `WORKBENCH_OUTPUT`: writable output directory, normally `/workspace/output`.

The request includes `execution.purpose`, `adapter.use`, `adapter.with`, optional scoped auth material, benchmark/candidate/task summary fields, expected output descriptors, and staged filesystem paths. Adapter commands should ignore request fields they do not understand.

Required outputs are phase-specific:

- `improve` writes `candidate_patch.json`.
- `run-task` writes one or more ordinary non-internal output files.
- `grade-task` writes `scorecard.json`.

Adapters can optionally write `.workbench/result.json` for summary, feedback, and usage metadata.

## Auth

Adapters declare auth in the manifest. Top-level `auth.methods` applies to the adapter itself. `auth.slots` declares named nested auth targets, such as a deploy token plus a model token. Methods can collect environment variables, profile files, or a local command that prints the bundle JSON.

Users connect auth with:

```bash
workbench auth connect my-agent --method api-key
workbench auth connect deployer/github --method token-file
```

Workbench injects only the auth required by the adapter invocation being executed. Hosted workers receive scoped adapter auth material, not user home directories or service credentials.

## Nested Adapters

`refs` are JSON pointers into an invocation's `with` object:

```yaml
id: orchestrator
protocol: workbench.adapter.v1
setup: []
command: workbench-adapter-orchestrator
refs:
  - /judge
```

If `run.with.judge.use` points at another adapter, `refs: ["/judge"]` tells Workbench to discover that nested adapter, include its source, apply default auth profiles, and report missing auth. Workbench does not automatically execute the child adapter. The parent adapter owns any delegation protocol, subprocess call, or API call it wants to make.

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

When `--request` is provided, Workbench parses the request, checks that `adapter.use` matches the manifest id, runs the adapter command with `WORKBENCH_ADAPTER_REQUEST` and `WORKBENCH_OUTPUT`, and verifies the required phase outputs. Use `--output` when you want a stable local output directory; otherwise Workbench creates a temporary output directory and reports it in command output. This is a local command replay, not a Docker or hosted execution.

## Compatibility

`workbench.adapter.v1` is the compatibility boundary. Within v1, Workbench may add optional request fields, optional result metadata fields, new auth methods, or new CLI inspection output. It should not remove required request fields, change required phase output filenames, or change manifest meaning without a new protocol string.

Adapter manifests are strict so authors catch misspelled fields early. Adapter request JSON is extensible so older adapters keep working when Workbench adds optional context.

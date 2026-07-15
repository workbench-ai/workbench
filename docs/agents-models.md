# Agents and models

Configure the agent, model label, and provider auth profile that Workbench uses for evals.

[Cases and grading](cases-grading.md) defines grading criteria. [Results](track.md) shows model and agent outcomes after a run.

## Agent source

Set the default agent and optional comparison agents in `.workbench/agents.yaml`:

```yaml
default: default
agents:
  default:
    adapter: codex
    with:
      auth: default
```

Omit `model` to use the adapter's current default. When you set one, Workbench passes the opaque label through without interpreting provider model families.

## Selectors

Commands use manifest defaults unless you pass selectors:

```bash
workbench eval run
workbench eval grade
workbench eval run --agents all
workbench eval grade --agents all
workbench eval run --agents default,strict
workbench eval run --versions all --agents all
```

Use `--agents all` for every configured comparison agent. Use a named list for one focused proof or a smaller comparison.

## Samples

Increase samples to measure variance:

```bash
workbench eval run -n 5
workbench eval grade
workbench skill improve -n 2
```

`grade` judges existing output and does not accept samples. Increase samples before publishing when a one-sample improvement proof changes source.

## Provider auth

Provider-backed agents require provider setup. Hosted runs also require captured Workbench auth:

```bash
workbench login codex
workbench login
```

Adapter auth and Workbench Cloud auth are separate. Hosted runs require Workbench Cloud login, adapter auth for harness-backed agents, and a Cloud skill that can run hosted operations. The adapter owns any provider-native setup guidance.

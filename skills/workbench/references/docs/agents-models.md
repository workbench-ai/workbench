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
    model: gpt-5.4-mini
    with:
      auth: default
```

Workbench passes `model` values through to the provider adapter. For Claude, use a Claude Code alias such as `opus` or `sonnet`, or a full Claude Code model id.

## Selectors

Commands use manifest defaults unless you pass selectors:

```bash
workbench eval
workbench eval --agents all
workbench eval --agents default,strict
workbench eval --versions all --agents all
```

Use `--agents all` for every configured comparison agent. Use a named list for one focused proof or a smaller comparison.

## Samples

Increase samples to measure variance:

```bash
workbench eval -n 5
workbench run --samples 3
workbench improve -n 2
```

`grade` judges existing output and does not accept samples. Increase samples before publishing when a one-sample improvement proof changes source.

## Provider auth

Provider-backed agents require provider setup. Hosted runs also require captured Workbench auth:

```bash
codex login --device-auth
workbench login codex --method oauth
workbench login
```

Native provider auth and Workbench Cloud auth are separate. Hosted runs require Workbench Cloud login, provider auth for provider-backed agents, and a Cloud skill that can run hosted operations.

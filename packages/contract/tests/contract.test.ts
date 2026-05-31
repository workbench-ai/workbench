import { describe, expect, test } from "vitest";

import type {
  RemoteWorkbenchJob,
  RuntimeSnapshot,
  WorkbenchExecutionSpec,
  WorkbenchRemoteCapabilities,
  WorkbenchRemoteJobClaim,
  WorkbenchRemoteJobClaimRequest,
  WorkbenchRemoteJobRenewal,
  WorkbenchRemoteJobRetry,
  WorkbenchRemoteRunRequest,
} from "../src/index";

describe("workbench contract", () => {
  test("keeps remote jobs and browser snapshots as plain serializable DTOs", () => {
    const job = {
      id: "job_1",
      projectId: "wb_1",
      runId: "run_1",
      kind: "execute",
      status: "queued",
      attempt: 0,
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:00.000Z",
      input: { sample: 1 },
    } satisfies RemoteWorkbenchJob;
    const snapshot = {
      workspaceRoot: "remote:wb_1",
      activeId: null,
      currentBenchmarkFingerprint: null,
      summaries: [],
      evaluations: [],
      runs: [],
    } satisfies RuntimeSnapshot;

    expect(JSON.parse(JSON.stringify({ job, snapshot }))).toMatchObject({
      job: { kind: "execute", status: "queued" },
      snapshot: { workspaceRoot: "remote:wb_1" },
    });
  });

  test("uses fingerprint-only candidate comparability and typed execution specs", () => {
    const execution = {
      id: "exec_1",
      projectId: "wb_1",
      runId: "run_1",
      purpose: "attempt",
      adapter: { use: "command", with: {} },
      sandbox: { kind: "oci", ref: "dockerfile://environment/Dockerfile" },
      inputs: [],
      outputs: [],
      policy: {
        tenantId: "user_1",
        resources: { cpu: 1, memoryGb: 1, diskGb: 1, timeoutMinutes: 1 },
        network: { egress: "none" },
      },
      metadata: {},
    } satisfies WorkbenchExecutionSpec;

    expect(execution.purpose).toBe("attempt");
  });

  test("keeps remote backend capabilities infrastructure independent", () => {
    const capabilities = {
      schema: "workbench.remote.capabilities.v1",
      contractVersion: 1,
      projectState: {
        schema: "workbench.project.state.v1",
        guardedSourceWrites: true,
        immutableRuntimeFacts: true,
      },
      execution: {
        fencedJobLeases: true,
        idempotentCompletion: true,
        progressIsBestEffort: true,
        maxJobsPerRun: 80,
      },
      sandbox: {
        production: "firecracker",
        local: "docker",
        networkPolicies: ["open", "none"],
      },
      blobs: {
        contentAddressed: true,
        maxUploadBytes: 104857600,
      },
    } satisfies WorkbenchRemoteCapabilities;

    expect(JSON.stringify(capabilities)).not.toMatch(/DynamoDB|SQS|S3|EC2/u);
    expect(capabilities.sandbox.production).toBe("firecracker");
  });

  test("models remote run starts as a path-scoped request DTO", () => {
    const request = {
      schema: "workbench.remote.run.request.v1",
      workflow: "eval",
      samples: 1,
      candidateId: "candidate_1",
      sourceYaml: "version: 4\nname: demo\n",
      candidateFiles: [{
        path: "run.js",
        content: "console.log('ok')\n",
      }],
      adapterFiles: [],
      rerun: true,
    } satisfies WorkbenchRemoteRunRequest;

    expect(JSON.stringify(request)).not.toMatch(/DynamoDB|SQS|S3|EC2/u);
    expect(request).not.toHaveProperty("projectId");
    expect(request).not.toHaveProperty("sourceRevisionId");
  });

  test("models remote job claims as fenced leases without naming wake-up infrastructure", () => {
    const request = {
      schema: "workbench.remote.job.claim_request.v1",
      ownerUserId: "user_1",
      projectId: "wb_1",
      runId: "run_1",
      jobId: "job_1",
      hostId: "host_1",
      workerId: "worker_1",
    } satisfies WorkbenchRemoteJobClaimRequest;
    const job = {
      id: "job_1",
      projectId: "wb_1",
      runId: "run_1",
      kind: "execute",
      status: "running",
      attempt: 1,
      createdAt: "2026-04-23T00:00:00.000Z",
      updatedAt: "2026-04-23T00:00:01.000Z",
      input: { execution: { id: "exec_1" } },
    } satisfies RemoteWorkbenchJob;
    const claim = {
      schema: "workbench.remote.job.claim.v1",
      claimed: true,
      disposition: "claimed",
      reason: "claimed",
      ownerUserId: "user_1",
      projectId: "wb_1",
      runId: "run_1",
      jobId: "job_1",
      leaseToken: "lease-secret",
      leaseUntil: "2026-04-23T00:05:01.000Z",
      job,
      input: { job },
    } satisfies WorkbenchRemoteJobClaim;
    const renewal = {
      schema: "workbench.remote.job.renewal.v1",
      ownerUserId: "user_1",
      projectId: "wb_1",
      runId: "run_1",
      jobId: "job_1",
      leaseToken: "lease-secret",
    } satisfies WorkbenchRemoteJobRenewal;
    const retry = {
      schema: "workbench.remote.job.retry.v1",
      ownerUserId: "user_1",
      projectId: "wb_1",
      runId: "run_1",
      jobId: "job_1",
      leaseToken: "lease-secret",
      reason: "transient sandbox host failure",
    } satisfies WorkbenchRemoteJobRetry;

    expect(JSON.stringify({ request, claim, renewal, retry })).not.toMatch(
      /queue|poll|wake|sqs|dynamo|s3|ec2/iu,
    );
    expect(claim.leaseToken).toBe("lease-secret");
  });
});

export type InitCandidateKind = "skill" | "pipeline" | "command";
export type InitAgent = string;

export interface WorkbenchInitScaffoldOptions {
  kind: InitCandidateKind;
  name: string;
  agent?: InitAgent;
  example: boolean;
}

export interface WorkbenchInitScaffoldFile {
  path: string;
  content: string;
}

export interface WorkbenchInitScaffold {
  kind: InitCandidateKind;
  name: string;
  candidateRoot: string;
  seedFileTarget: string;
  seedDirectoryTarget: string;
  files: WorkbenchInitScaffoldFile[];
}

export function createWorkbenchInitScaffold(options: WorkbenchInitScaffoldOptions): WorkbenchInitScaffold {
  const slug = slugify(options.name);
  if (options.kind === "skill") {
    const agent = requireAgent(options);
    return {
      kind: "skill",
      name: options.name,
      candidateRoot: `subjects/${agent}/files`,
      seedFileTarget: `subjects/${agent}/files/SKILL.md`,
      seedDirectoryTarget: `subjects/${agent}/files`,
      files: [
        { path: "benchmark.yaml", content: skillBenchmarkSpec(options.name, agent) },
        { path: `subjects/${agent}/subject.yaml`, content: skillCandidateSpec(options.name, agent) },
        { path: `optimizers/${agent}.yaml`, content: optimizerSpec(options.name, "SKILL.md", agent) },
        { path: `subjects/${agent}/files/SKILL.md`, content: skillMarkdown(options.name, slug, options.example) },
        { path: `subjects/${agent}/files/agents/openai.yaml`, content: skillOpenAiMetadata(options.name, slug) },
        { path: "environment/Dockerfile", content: agentDockerfile(agent) },
        { path: "tasks/task-001/task.yaml", content: taskYaml(skillCasePrompt(options.name)) },
        { path: "tasks/task-001/tests/rubric.md", content: skillExpectedRubric() },
        ...(options.example ? [
          { path: "tasks/task-002/task.yaml", content: taskYaml(`Use ${options.name} for a second realistic prompt with different constraints.\n`) },
          { path: "tasks/task-002/tests/rubric.md", content: skillExpectedRubric() },
        ] : []),
      ],
    };
  }
  if (options.kind === "pipeline") {
    const agent = requireAgent(options);
    return {
      kind: "pipeline",
      name: options.name,
      candidateRoot: `subjects/${agent}/files`,
      seedFileTarget: `subjects/${agent}/files/pipeline.yaml`,
      seedDirectoryTarget: `subjects/${agent}/files`,
      files: [
        { path: "benchmark.yaml", content: pipelineBenchmarkSpec(options.name, agent) },
        { path: `subjects/${agent}/subject.yaml`, content: pipelineCandidateSpec(options.name, agent) },
        { path: `optimizers/${agent}.yaml`, content: optimizerSpec(options.name, "pipeline.yaml", agent) },
        { path: `subjects/${agent}/files/pipeline.yaml`, content: pipelineSpec(slug, options.name) },
        { path: "environment/Dockerfile", content: agentDockerfile(agent) },
        { path: "tasks/task-001/task.yaml", content: taskYaml(pipelineCasePrompt(options.name)) },
        { path: "tasks/task-001/tests/rubric.md", content: pipelineExpectedRubric() },
        ...(options.example ? [
          { path: "tasks/task-002/task.yaml", content: taskYaml(`Run ${options.name} on a second example and inspect pipeline-output.log again.\n`) },
          { path: "tasks/task-002/tests/rubric.md", content: pipelineExpectedRubric() },
        ] : []),
      ],
    };
  }
  return {
    kind: "command",
    name: options.name,
    candidateRoot: "subjects/command/files",
    seedFileTarget: "subjects/command/files/run.js",
    seedDirectoryTarget: "subjects/command/files",
    files: [
      { path: "benchmark.yaml", content: commandBenchmarkSpec(options.name) },
      { path: "subjects/command/subject.yaml", content: commandCandidateSpec(options.name) },
      { path: "optimizers/command.yaml", content: commandOptimizerSpec(options.name) },
      { path: "subjects/command/files/run.js", content: commandRunnerSource() },
      { path: "environment/Dockerfile", content: nodeDockerfile() },
      { path: "tasks/task-001/task.yaml", content: taskYaml("The command should produce a concise result for this task.\n") },
      { path: "tasks/task-001/tests/required-output.txt", content: "command subject ran\n" },
      { path: "tasks/task-001/tests/test.sh", content: commandTestScript() },
      ...(options.example ? [
        { path: "tasks/task-002/task.yaml", content: taskYaml("The command should still produce deterministic output for a second task.\n") },
        { path: "tasks/task-002/tests/required-output.txt", content: "command subject ran\n" },
        { path: "tasks/task-002/tests/test.sh", content: commandTestScript() },
      ] : []),
    ],
  };
}

function requireAgent(options: WorkbenchInitScaffoldOptions): InitAgent {
  if (options.agent && /^[a-z][a-z0-9-]*$/u.test(options.agent)) {
    return options.agent;
  }
  throw new Error(`--agent is required for --${options.kind} and must be a lowercase adapter id.`);
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug || "workbench-subject";
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function taskYaml(task: string): string {
  return [
    "task: |-",
    ...task.trimEnd().split("\n").map((line) => `  ${line}`),
    "",
  ].join("\n");
}

function skillBenchmarkSpec(name: string, agent: InitAgent): string {
  return [
    "version: 2",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(`Evaluate the ${name} skill across representative tasks.`)}`,
    "tasks: tasks",
    "environment:",
    "  dockerfile: environment/Dockerfile",
    "score:",
    "  use: rubric",
    "  with:",
    "    instructions: Score the completed task from the same working directory and any verifier files mounted at /tests. Do not score the subject instructions by keyword matching.",
    "    judge:",
    `      use: ${agent}`,
    "    criteria:",
    "      - id: task_fit",
    "        description: The response follows the task prompt and uses the skill's workflow.",
    "        weight: 1",
    "      - id: output_quality",
    "        description: The produced output is complete, readable, and directly useful.",
    "        weight: 1",
    "",
  ].join("\n");
}

function skillCandidateSpec(name: string, agent: InitAgent): string {
  return [
    "version: 2",
    `name: ${yamlString(name)}`,
    "run:",
    `  use: ${agent}`,
    "  with:",
    "    instructions: Use the subject files and public task files already present in the current working directory. Mutate the working directory to complete the task.",
    "",
  ].join("\n");
}

function pipelineBenchmarkSpec(name: string, agent: InitAgent): string {
  return [
    "version: 2",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(`Evaluate the ${name} pipeline across representative tasks.`)}`,
    "tasks: tasks",
    "environment:",
    "  dockerfile: environment/Dockerfile",
    "score:",
    "  use: rubric",
    "  with:",
    "    instructions: Score whether the pipeline output satisfies the task and records useful output.",
    "    judge:",
    `      use: ${agent}`,
    "    criteria:",
    "      - id: completes",
    "        description: The pipeline completes and writes the expected output.",
    "        weight: 1",
    "      - id: output_quality",
    "        description: The output files are specific enough to judge the subject behavior.",
    "        weight: 1",
    "",
  ].join("\n");
}

function pipelineCandidateSpec(name: string, agent: InitAgent): string {
  return [
    "version: 2",
    `name: ${yamlString(name)}`,
    "run:",
    `  use: ${agent}`,
    "  with:",
    "    instructions: Use the pipeline files and public task files already present in the current working directory. Mutate the working directory to complete the task.",
    "",
  ].join("\n");
}

function optimizerSpec(name: string, editablePath: string, agent: InitAgent): string {
  return [
    "version: 2",
    `name: ${yamlString(`${name} optimizer`)}`,
    `description: ${yamlString(`Improve subject files for ${name}.`)}`,
    "edits:",
    `  - ${editablePath}`,
    "improve:",
    `  use: ${agent}`,
    "",
  ].join("\n");
}

function commandBenchmarkSpec(name: string): string {
  return [
    "version: 2",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(`Evaluate the ${name} command implementation across representative tasks.`)}`,
    "tasks: tasks",
    "environment:",
    "  dockerfile: environment/Dockerfile",
    "score:",
    "  use: tests",
    "",
  ].join("\n");
}

function commandCandidateSpec(name: string): string {
  const runnerCommand = JSON.stringify("node run.js");
  return [
    "version: 2",
    `name: ${yamlString(name)}`,
    "run:",
    "  use: command",
    "  with:",
    `    command: ${runnerCommand}`,
    "",
  ].join("\n");
}

function commandOptimizerSpec(name: string): string {
  const optimizerCommand = JSON.stringify("node -e \"const fs=require('fs');const file='/workspace/input/candidate/run.js';const current=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';const next=current.replace(/\\s*$/,'')+'\\n// Workbench subject revision.\\n';fs.mkdirSync('/workspace/output',{recursive:true});fs.writeFileSync('/workspace/output/candidate_patch.json',JSON.stringify({files:[{path:'run.js',encoding:'utf8',content:next,executable:false}],fileChanges:['run.js'],summary:'Updated command subject.'},null,2));\"");
  return [
    "version: 2",
    `name: ${yamlString(`${name} optimizer`)}`,
    `description: ${yamlString(`Improve subject command files for ${name}.`)}`,
    "edits:",
    "  - run.js",
    "improve:",
    "  use: command",
    "  with:",
    `    command: ${optimizerCommand}`,
    "",
  ].join("\n");
}

function commandTestScript(): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "expected=$(cat /tests/required-output.txt)",
    "actual=$(cat command-output.txt 2>/dev/null || true)",
    "mkdir -p /logs/verifier",
    "case \"$actual\" in",
    "  *\"$expected\"*) printf '{\"reward\":1,\"exact\":1}\\n' > /logs/verifier/reward.json ;;",
    "  *) printf '{\"reward\":0,\"exact\":0}\\n' > /logs/verifier/reward.json ;;",
    "esac",
    "",
  ].join("\n");
}

function agentDockerfile(agent: InitAgent): string {
  void agent;
  return [
    "FROM node:22-slim",
    "",
    ...caCertificatesDockerfileStep(),
    "",
  ].join("\n");
}

function nodeDockerfile(): string {
  return [
    "FROM node:22-slim",
    "",
    ...caCertificatesDockerfileStep(),
    "",
  ].join("\n");
}

function caCertificatesDockerfileStep(): string[] {
  return [
    "RUN apt-get update \\",
    "    && apt-get install -y --no-install-recommends ca-certificates \\",
    "    && rm -rf /var/lib/apt/lists/*",
  ];
}

function skillMarkdown(name: string, slug: string, example: boolean): string {
  return [
    "---",
    `name: ${slug}`,
    `description: ${yamlString(`Use this skill whenever the user asks for ${name} work, related deliverable generation, or iterative improvement of this workflow.`)}`,
    "---",
    "",
    `# ${name}`,
    "",
    "Use this skill to turn the user's request into a concrete deliverable.",
    "",
    "## Workflow",
    "",
    "1. Identify the requested deliverable and success criteria.",
    "2. Gather only the source context needed for this deliverable.",
    "3. Produce the deliverable in the format the user can use directly.",
    "4. Validate the output against the success criteria before returning it.",
    "",
    ...(example ? [
      "## Example",
      "",
      "When a prompt asks for a concrete deliverable, produce the deliverable first and keep explanation secondary.",
      "",
    ] : []),
  ].join("\n");
}

function skillOpenAiMetadata(name: string, slug: string): string {
  return [
    `name: ${slug}`,
    `description: ${yamlString(`Generate and improve ${name} deliverables.`)}`,
    "",
  ].join("\n");
}

function skillCasePrompt(name: string): string {
  return [
    `Use the ${name} skill to produce a small but complete deliverable for a realistic request.`,
    "Return the deliverable content and a one-sentence validation note.",
    "",
  ].join("\n");
}

function skillExpectedRubric(): string {
  return [
    "Reward complete, usable deliverables created from the task input.",
    "Penalize placeholder output, missing validation, and keyword-only compliance.",
    "",
  ].join("\n");
}

function pipelineSpec(slug: string, name: string): string {
  return [
    "metadata:",
    `  id: ${slug}`,
    `  name: ${yamlString(name)}`,
    "hooks:",
    "  beforeRun: |",
    `    printf 'pipeline ${slug} ran\\n' > pipeline-output.log`,
    "stages: []",
    "",
  ].join("\n");
}

function pipelineCasePrompt(name: string): string {
  return [
    `Run the ${name} pipeline and inspect the emitted pipeline-output.log output.`,
    "The output should make it clear that the pipeline ran.",
    "",
  ].join("\n");
}

function pipelineExpectedRubric(): string {
  return [
    "Reward pipeline runs that produce concrete output and explain what happened.",
    "Penalize missing logs, placeholder output, and files that cannot be inspected.",
    "",
  ].join("\n");
}

function commandRunnerSource(): string {
  return [
    "const fs = require('fs');",
    "const path = require('path');",
    "",
    "fs.writeFileSync(path.join(process.cwd(), 'command-output.txt'), 'command subject ran\\n');",
    "console.log('command subject ran');",
    "",
  ].join("\n");
}

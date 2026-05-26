import type {
  InitAgent,
  InitSubjectKind,
  WorkbenchInitScaffoldFile,
} from "./init-scaffold.js";

interface WorkbenchInitTemplateContext {
  name: string;
  slug: string;
  agent?: InitAgent;
  example: boolean;
}

export interface WorkbenchInitTemplate {
  kind: InitSubjectKind;
  requiresAgent: boolean;
  subjectRoot(context: WorkbenchInitTemplateContext): string;
  seedFileTarget(context: WorkbenchInitTemplateContext): string;
  seedDirectoryTarget(context: WorkbenchInitTemplateContext): string;
  files(context: WorkbenchInitTemplateContext): WorkbenchInitScaffoldFile[];
}

export type WorkbenchInitTemplatePack = Record<InitSubjectKind, WorkbenchInitTemplate>;

export const defaultWorkbenchInitTemplatePack: WorkbenchInitTemplatePack = {
  skill: {
    kind: "skill",
    requiresAgent: true,
    subjectRoot: ({ agent }) => `subjects/${requiredAgent(agent)}/files`,
    seedFileTarget: ({ agent }) => `subjects/${requiredAgent(agent)}/files/SKILL.md`,
    seedDirectoryTarget: ({ agent }) => `subjects/${requiredAgent(agent)}/files`,
    files: ({ name, slug, agent, example }) => {
      const adapter = requiredAgent(agent);
      return [
        { path: "benchmark.yaml", content: skillBenchmarkSpec(name, adapter) },
        { path: `subjects/${adapter}/subject.yaml`, content: skillSubjectSpec(name, adapter) },
        { path: `optimizers/${adapter}.yaml`, content: optimizerSpec(name, "SKILL.md", adapter) },
        { path: `subjects/${adapter}/files/SKILL.md`, content: skillMarkdown(name, slug, example) },
        { path: `subjects/${adapter}/files/prepare.sh`, content: subjectPrepareScript() },
        { path: `subjects/${adapter}/files/agents/openai.yaml`, content: skillOpenAiMetadata(name, slug) },
        { path: "environment/Dockerfile", content: nodeDockerfile() },
        { path: "tasks/task-001/task.yaml", content: taskYaml(skillCasePrompt(name)) },
        { path: "tasks/task-001/tests/rubric.md", content: skillExpectedRubric() },
        ...(example ? [
          { path: "tasks/task-002/task.yaml", content: taskYaml(`Use ${name} for a second realistic prompt with different constraints.\n`) },
          { path: "tasks/task-002/tests/rubric.md", content: skillExpectedRubric() },
        ] : []),
      ];
    },
  },
  command: {
    kind: "command",
    requiresAgent: false,
    subjectRoot: () => "subjects/command/files",
    seedFileTarget: () => "subjects/command/files/run.js",
    seedDirectoryTarget: () => "subjects/command/files",
    files: ({ name, example }) => [
      { path: "benchmark.yaml", content: commandBenchmarkSpec(name) },
      { path: "subjects/command/subject.yaml", content: commandSubjectSpec(name) },
      { path: "optimizers/command.yaml", content: commandOptimizerSpec(name) },
      { path: "subjects/command/files/run.js", content: commandRunnerSource() },
      { path: "subjects/command/files/prepare.sh", content: subjectPrepareScript() },
      { path: "environment/Dockerfile", content: nodeDockerfile() },
      { path: "tasks/task-001/task.yaml", content: taskYaml("The command should produce a concise result for this task.\n") },
      { path: "tasks/task-001/tests/required-output.txt", content: "command subject ran\n" },
      { path: "tasks/task-001/tests/test.sh", content: commandTestScript() },
      ...(example ? [
        { path: "tasks/task-002/task.yaml", content: taskYaml("The command should still produce deterministic output for a second task.\n") },
        { path: "tasks/task-002/tests/required-output.txt", content: "command subject ran\n" },
        { path: "tasks/task-002/tests/test.sh", content: commandTestScript() },
      ] : []),
    ],
  },
};

function requiredAgent(agent: InitAgent | undefined): InitAgent {
  if (!agent) {
    throw new Error("Template requires an agent adapter id.");
  }
  return agent;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function taskYaml(task: string): string {
  return [
    "version: 3",
    "task: |-",
    ...task.trimEnd().split("\n").map((line) => `  ${line}`),
    "tests:",
    "  path: tests",
    "",
  ].join("\n");
}

function skillBenchmarkSpec(name: string, agent: InitAgent): string {
  return [
    "version: 3",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(`Evaluate the ${name} skill across representative tasks.`)}`,
    "engine:",
    "  use: workbench",
    "  with:",
    "    environment:",
    "      dockerfile: environment/Dockerfile",
    "    score:",
    "      use: rubric",
    "      with:",
    "        instructions: Score the completed task from the current working directory and engine-private verifier files. Do not score the subject guidance by keyword matching.",
    "        parallelism: 2",
    "        judge:",
    `          use: ${agent}`,
    ...agentDefaultWithLines(agent, "          "),
    "        criteria:",
    "          - id: task_fit",
    "            description: The response follows the task prompt and uses the skill's workflow.",
    "            weight: 1",
    "          - id: output_quality",
    "            description: The produced output is complete, readable, and directly useful.",
    "            weight: 1",
    "",
  ].join("\n");
}

function skillSubjectSpec(name: string, agent: InitAgent): string {
  return [
    "version: 3",
    `name: ${yamlString(name)}`,
    "files:",
    "  path: files",
    "prepare:",
    "  command: sh input/subject/prepare.sh",
    "run:",
    `  use: ${agent}`,
    ...agentDefaultWithLines(agent, "  "),
    "",
  ].join("\n");
}

function optimizerSpec(name: string, editablePath: string, agent: InitAgent): string {
  return [
    "version: 3",
    `name: ${yamlString(`${name} optimizer`)}`,
    `description: ${yamlString(`Improve subject files for ${name}.`)}`,
    "edits:",
    `  - ${editablePath}`,
    "improve:",
    `  use: ${agent}`,
    ...agentDefaultWithLines(agent, "  "),
    "",
  ].join("\n");
}

function agentDefaultWithLines(agent: InitAgent, indent: string): string[] {
  if (agent !== "codex") {
    return [];
  }
  return [
    `${indent}with:`,
    `${indent}  model: gpt-5.5`,
  ];
}

function commandBenchmarkSpec(name: string): string {
  return [
    "version: 3",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(`Evaluate the ${name} command implementation across representative tasks.`)}`,
    "engine:",
    "  use: workbench",
    "  with:",
    "    environment:",
    "      dockerfile: environment/Dockerfile",
    "    score:",
    "      use: tests",
    "",
  ].join("\n");
}

function commandSubjectSpec(name: string): string {
  const runnerCommand = JSON.stringify("node run.js");
  return [
    "version: 3",
    `name: ${yamlString(name)}`,
    "files:",
    "  path: files",
    "prepare:",
    "  command: sh input/subject/prepare.sh",
    "run:",
    "  use: command",
    "  with:",
    `    command: ${runnerCommand}`,
    "",
  ].join("\n");
}

function commandOptimizerSpec(name: string): string {
  const optimizerCommand = JSON.stringify("node -e \"const fs=require('fs');const file='run.js';const current=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';const next=current.replace(/\\s*$/,'')+'\\n// Workbench subject revision.\\n';fs.writeFileSync(file,next);\"");
  return [
    "version: 3",
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

function subjectPrepareScript(): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "cp -R input/subject/. .",
    "",
  ].join("\n");
}

function commandTestScript(): string {
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "expected=$(node -e \"const fs=require('fs'),path=require('path');const r=JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST,'utf8'));process.stdout.write(fs.readFileSync(path.join(r.paths.enginePrivate,'required-output.txt'),'utf8'));\")",
    "verifier_output=${WORKBENCH_TESTS_VERIFIER_DIR:-$(node -e \"const fs=require('fs'),path=require('path');const r=JSON.parse(fs.readFileSync(process.env.WORKBENCH_ADAPTER_REQUEST,'utf8'));process.stdout.write(path.join(r.paths.output,'.workbench','internal','verifier'));\")}",
    "actual=$(cat command-output.txt 2>/dev/null || true)",
    "mkdir -p \"$verifier_output\"",
    "case \"$actual\" in",
    "  *\"$expected\"*) printf '{\"reward\":1,\"exact\":1}\\n' > \"$verifier_output/reward.json\" ;;",
    "  *) printf '{\"reward\":0,\"exact\":0}\\n' > \"$verifier_output/reward.json\" ;;",
    "esac",
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

import { defaultWorkbenchInitTemplatePack } from "./init-template-pack.js";

export type InitSubjectKind = "skill" | "command";
export type InitAgent = string;

export interface WorkbenchInitScaffoldOptions {
  kind: InitSubjectKind;
  name: string;
  agent?: InitAgent;
  example: boolean;
}

export interface WorkbenchInitScaffoldFile {
  path: string;
  content: string;
}

export interface WorkbenchInitScaffold {
  kind: InitSubjectKind;
  name: string;
  subjectRoot: string;
  seedFileTarget: string;
  seedDirectoryTarget: string;
  files: WorkbenchInitScaffoldFile[];
}

export function createWorkbenchInitScaffold(options: WorkbenchInitScaffoldOptions): WorkbenchInitScaffold {
  const template = defaultWorkbenchInitTemplatePack[options.kind];
  const slug = slugify(options.name);
  const agent = template.requiresAgent ? requireAgent(options) : undefined;
  const context = {
    name: options.name,
    slug,
    ...(agent ? { agent } : {}),
    example: options.example,
  };
  return {
    kind: template.kind,
    name: options.name,
    subjectRoot: template.subjectRoot(context),
    seedFileTarget: template.seedFileTarget(context),
    seedDirectoryTarget: template.seedDirectoryTarget(context),
    files: template.files(context),
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

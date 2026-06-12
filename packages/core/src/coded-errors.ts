import type { Json } from "@workbench-ai/workbench-contract";

export interface WorkbenchCodedErrorOptions {
  retryable?: boolean;
  remediation?: string;
  subject?: Record<string, Json>;
  exitCode?: number;
}

export class WorkbenchUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbenchUserError";
  }
}

export class WorkbenchCodedError extends WorkbenchUserError {
  readonly code: string;
  readonly retryable: boolean;
  readonly remediation?: string;
  readonly subject?: Record<string, Json>;
  readonly exitCode: number;

  constructor(code: string, message: string, options: WorkbenchCodedErrorOptions = {}) {
    super(message);
    this.name = "WorkbenchCodedError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.remediation) {
      this.remediation = options.remediation;
    }
    if (options.subject) {
      this.subject = options.subject;
    }
    this.exitCode = options.exitCode ?? 1;
  }
}

export function codedErrorFromUnknown(error: unknown, fallbackCode = "internal"): {
  code: string;
  message: string;
  retryable: boolean;
  remediation?: string;
  subject?: Record<string, Json>;
  exitCode: number;
} {
  if (error instanceof WorkbenchCodedError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.remediation ? { remediation: error.remediation } : {}),
      ...(error.subject ? { subject: error.subject } : {}),
      exitCode: error.exitCode,
    };
  }
  if (error instanceof WorkbenchUserError) {
    return {
      code: "usage",
      message: error.message,
      retryable: false,
      exitCode: 2,
    };
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    exitCode: 1,
  };
}

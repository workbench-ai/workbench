import { gzipSync } from "node:zlib";

import {
  parseWorkbenchCloudErrorBody,
  type WorkbenchCloudErrorBody,
} from "@workbench-ai/workbench-contract";

const GZIP_THRESHOLD_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 3;

interface WorkbenchCloudHttpFailure {
  apiPath: string;
  status: number;
  statusText: string;
  text: string;
  cloudError: WorkbenchCloudErrorBody | null;
}

interface WorkbenchCloudJsonRequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  token?: string;
  mapHttpError: (failure: WorkbenchCloudHttpFailure) => Error;
  mapTransportError: (error: unknown, apiPath: string) => Error;
}

export async function requestWorkbenchCloudJson<T>(
  baseUrl: string,
  apiPath: string,
  options: WorkbenchCloudJsonRequestOptions,
): Promise<T> {
  const method = options.method ?? "GET";
  const canRetry = method === "GET" || method === "PUT" || method === "DELETE";
  const requestBody = encodeJsonBody(options.body);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${apiPath}`, {
        method,
        signal: options.signal,
        headers: {
          ...requestBody.headers,
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        body: requestBody.body,
      });
    } catch (error) {
      if (
        canRetry &&
        attempt < MAX_ATTEMPTS &&
        !options.signal?.aborted &&
        isTransientTransportError(error)
      ) {
        await waitBeforeRetry(attempt);
        continue;
      }
      throw options.mapTransportError(error, apiPath);
    }
    const text = await response.text();
    if (response.ok) {
      return (text ? JSON.parse(text) : {}) as T;
    }
    const failure = {
      apiPath,
      status: response.status,
      statusText: response.statusText,
      text,
      cloudError: parseWorkbenchCloudErrorBody(text),
    };
    if (
      canRetry &&
      attempt < MAX_ATTEMPTS &&
      (failure.cloudError?.retryable === true || response.status === 429 || response.status >= 500)
    ) {
      await waitBeforeRetry(attempt);
      continue;
    }
    throw options.mapHttpError(failure);
  }
  throw new Error("Workbench Cloud request exhausted its retry budget.");
}

function encodeJsonBody(body: unknown): {
  body?: BodyInit;
  headers: Record<string, string>;
} {
  if (body == null) {
    return { headers: { "content-type": "application/json" } };
  }
  const text = JSON.stringify(body);
  if (Buffer.byteLength(text) < GZIP_THRESHOLD_BYTES) {
    return { body: text, headers: { "content-type": "application/json" } };
  }
  const compressed = gzipSync(text);
  return {
    body: compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
    headers: {
      "content-encoding": "gzip",
      "content-type": "application/json",
    },
  };
}

function isTransientTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(?:fetch failed|socket hang up|network error|terminated|timeout|TimeoutError|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|EPIPE|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT)\b/iu.test(message);
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
}

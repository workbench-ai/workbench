export function requiredRecord<T = unknown>(
  value: unknown,
  label: string,
): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, T>;
}

export function rejectUnknownKeys(
  record: Record<string, unknown>,
  label: string,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new Error(`${label} includes unsupported fields: ${unknown.join(", ")}.`);
  }
}

export type FailureClassification = "infrastructure" | "functional";

export function classifyFailure(message: string): FailureClassification {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("docker") ||
    normalized.includes("network") ||
    normalized.includes("timeout") ||
    normalized.includes("redis") ||
    normalized.includes("postgres") ||
    normalized.includes("spawn") ||
    normalized.includes("storage")
  ) {
    return "infrastructure";
  }

  return "functional";
}

export function isRetryableFailure(message: string): boolean {
  return classifyFailure(message) === "infrastructure";
}

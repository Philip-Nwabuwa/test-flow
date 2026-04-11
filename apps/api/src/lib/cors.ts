export function parseAllowedOrigins(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function matchesPattern(origin: string, pattern: string) {
  if (pattern === "*") {
    return true;
  }

  if (!pattern.includes("*")) {
    return origin === pattern;
  }

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${escaped}$`).test(origin);
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.length === 0) {
    return true;
  }

  return allowedOrigins.some((pattern) => matchesPattern(origin, pattern));
}

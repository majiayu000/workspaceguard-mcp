export function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
  };
}

export function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
    structuredContent: { error: message },
  };
}

export function asStructured(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

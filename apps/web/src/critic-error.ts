export function criticErrorMessage(data: unknown): string {
  if (typeof data !== "string") return "Critic unavailable";
  try {
    const payload: unknown = JSON.parse(data);
    if (
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string" &&
      payload.message.trim()
    ) {
      return payload.message;
    }
  } catch {
    // Fall through to the stable writer-facing message.
  }
  return "Critic unavailable";
}

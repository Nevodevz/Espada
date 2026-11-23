/** Turning a FastAPI error body into something a toast can show. */

/** Human-readable text of a FastAPI `detail` (string, `{message}` object or validation list). */
export function apiErrorMessage(detail: unknown, status: number): string {
  const fallback = `Ошибка запроса (HTTP ${status})`;
  if (typeof detail === "string") return detail || fallback;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === "object" && typeof (d as { msg?: unknown }).msg === "string" ? (d as { msg: string }).msg : ""))
      .filter(Boolean);
    return msgs.length ? msgs.join("; ") : fallback;
  }
  if (detail && typeof detail === "object") {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

/** The already-existing lead a `POST /leads` 409 points at, if the error carries one. */
export function existingLeadFromError(e: unknown): { id: number; client_name: string } | null {
  if (!e || typeof e !== "object") return null;
  const { status, detail } = e as { status?: unknown; detail?: unknown };
  if (status !== 409 || !detail || typeof detail !== "object") return null;
  const existing = (detail as { existing?: { id?: unknown; client_name?: unknown } }).existing;
  if (!existing || typeof existing.id !== "number") return null;
  return { id: existing.id, client_name: typeof existing.client_name === "string" ? existing.client_name : "" };
}

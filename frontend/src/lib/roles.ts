import type { User } from "./types";

/** Closer = explicit `is_closer` flag on an active employee (not the position text). */
export function isCloser(u: Pick<User, "is_closer" | "is_active">): boolean {
  return Boolean(u.is_closer) && u.is_active !== false;
}

/**
 * Options for a «Клоузер» dropdown: active closers sorted by name, plus the
 * currently assigned user even if they are no longer a closer, so an existing
 * value never renders as empty.
 */
export function closerOptions<T extends Pick<User, "id" | "name" | "is_closer" | "is_active">>(
  users: T[],
  keepId?: number | null,
): T[] {
  const list = users.filter(isCloser).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  if (keepId && !list.some((u) => u.id === keepId)) {
    const kept = users.find((u) => u.id === keepId);
    if (kept) list.push(kept);
  }
  return list;
}

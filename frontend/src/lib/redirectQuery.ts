/** `searchParams` as Next.js passes it to a page component. */
export type PageSearchParams = Record<string, string | string[] | undefined>;

/**
 * Builds the target of a legacy-URL redirect, keeping the incoming query.
 * `forced` values win over incoming ones (e.g. `view=board` for `/leads/board`).
 */
export function withQuery(path: string, incoming: PageSearchParams = {}, forced: Record<string, string> = {}): string {
  const p = new URLSearchParams(forced);
  for (const [key, value] of Object.entries(incoming)) {
    if (key in forced || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) p.append(key, v);
  }
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Where the old `/dept/sales` page goes: the meetings modal became its own page. */
export function salesDeptTarget(incoming: PageSearchParams = {}): string {
  return incoming.meetings === "1" ? "/sales/meetings" : "/sales/metrics";
}

export type LeadsView = "board" | "list";

export const LEADS_VIEW_KEY = "leads.view";

const isView = (value: string | null): value is LeadsView => value === "board" || value === "list";

/** URL parameter wins over the stored choice; the board is the default. */
export function resolveLeadsView(param: string | null, stored: string | null): LeadsView {
  if (isView(param)) return param;
  if (isView(stored)) return stored;
  return "board";
}

export function readStoredLeadsView(): string | null {
  try {
    return localStorage.getItem(LEADS_VIEW_KEY);
  } catch {
    return null;
  }
}

export function storeLeadsView(view: LeadsView): void {
  try {
    localStorage.setItem(LEADS_VIEW_KEY, view);
  } catch {
    /* storage unavailable (private mode) — the choice just is not remembered */
  }
}

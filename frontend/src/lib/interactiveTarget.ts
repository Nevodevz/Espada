/** Links, buttons and form controls inside a card keep their own click behaviour: no drag, no card navigation. */
export const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, [role='menu'], [role='menuitem']";

export function isInteractiveTarget(el: Element | null): boolean {
  return !!el && typeof el.closest === "function" && el.closest(INTERACTIVE_SELECTOR) !== null;
}

/** Ctrl/Cmd/Shift + click opens the target in a new tab, like a regular link. */
export function opensInNewTab(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey || e.shiftKey;
}

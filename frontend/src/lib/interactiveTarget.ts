/** Links, buttons and form controls inside a card keep their own click behaviour: no drag, no card navigation. */
export const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, [role='menu'], [role='menuitem']";

export function isInteractiveTarget(el: Element | null): boolean {
  return !!el && typeof el.closest === "function" && el.closest(INTERACTIVE_SELECTOR) !== null;
}

import { describe, expect, it } from "vitest";
import { INTERACTIVE_SELECTOR, isInteractiveTarget } from "./interactiveTarget";

const fake = (matches: boolean) => ({ closest: (sel: string) => (sel === INTERACTIVE_SELECTOR && matches ? {} : null) }) as unknown as Element;

describe("isInteractiveTarget", () => {
  it("null is not interactive", () => expect(isInteractiveTarget(null)).toBe(false));
  it("element inside a link/button/control is interactive", () => expect(isInteractiveTarget(fake(true))).toBe(true));
  it("plain element is not interactive", () => expect(isInteractiveTarget(fake(false))).toBe(false));
  it("selector covers the required controls", () => {
    for (const s of ["a", "button", "input", "select", "textarea", "[role='menu']"]) expect(INTERACTIVE_SELECTOR).toContain(s);
  });
});

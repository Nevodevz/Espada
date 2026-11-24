import { describe, expect, it } from "vitest";
import { INTERACTIVE_SELECTOR, isInteractiveTarget, opensInNewTab } from "./interactiveTarget";

const fake = (matches: boolean) => ({ closest: (sel: string) => (sel === INTERACTIVE_SELECTOR && matches ? {} : null) }) as unknown as Element;

describe("isInteractiveTarget", () => {
  it("null is not interactive", () => expect(isInteractiveTarget(null)).toBe(false));
  it("element inside a link/button/control is interactive", () => expect(isInteractiveTarget(fake(true))).toBe(true));
  it("plain element is not interactive", () => expect(isInteractiveTarget(fake(false))).toBe(false));
  it("selector covers the required controls", () => {
    for (const s of ["a", "button", "input", "select", "textarea", "[role='menu']"]) expect(INTERACTIVE_SELECTOR).toContain(s);
  });
});

describe("opensInNewTab", () => {
  const ev = (over: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}) =>
    ({ ctrlKey: false, metaKey: false, shiftKey: false, ...over });
  it("plain click stays in the tab", () => expect(opensInNewTab(ev())).toBe(false));
  it("ctrl click opens a new tab", () => expect(opensInNewTab(ev({ ctrlKey: true }))).toBe(true));
  it("cmd click opens a new tab", () => expect(opensInNewTab(ev({ metaKey: true }))).toBe(true));
  it("shift click opens a new tab", () => expect(opensInNewTab(ev({ shiftKey: true }))).toBe(true));
});

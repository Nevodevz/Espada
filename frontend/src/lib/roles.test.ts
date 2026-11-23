import { describe, expect, it } from "vitest";
import { closerOptions, isCloser, isSalesHead } from "./roles";

const u = (id: number, name: string, is_closer: boolean, is_active = true) =>
  ({ id, name, is_closer, is_active }) as any;

describe("closers", () => {
  it("uses the flag, not the position", () => {
    expect(isCloser({ is_closer: true, is_active: true })).toBe(true);
    expect(isCloser({ is_closer: false, is_active: true })).toBe(false);
  });

  it("hides archived closers", () => {
    expect(isCloser({ is_closer: true, is_active: false })).toBe(false);
  });

  it("lists active closers by name and keeps the currently assigned one", () => {
    const list = [u(1, "Марлен", true), u(2, "Адахан", true), u(3, "Рахима", false), u(4, "Старый", true, false)];
    expect(closerOptions(list).map((x) => x.id)).toEqual([2, 1]);
    expect(closerOptions(list, 3).map((x) => x.id)).toEqual([2, 1, 3]);
  });
});

describe("isSalesHead", () => {
  it("accepts the sales head position", () => {
    expect(isSalesHead({ role: "staff", is_founder: false, position: "Руководитель продаж" })).toBe(true);
  });

  it("accepts admins and founders", () => {
    expect(isSalesHead({ role: "admin", is_founder: false, position: "Сеттер" })).toBe(true);
    expect(isSalesHead({ role: "staff", is_founder: true, position: "Сеттер" })).toBe(true);
  });

  it("rejects a setter", () => {
    expect(isSalesHead({ role: "staff", is_founder: false, position: "Сеттер" })).toBe(false);
  });
});

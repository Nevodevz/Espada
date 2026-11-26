import { describe, expect, it } from "vitest";
import { normalizeUsername } from "./telegramSettings";

describe("normalizeUsername", () => {
  it("strips @ and spaces", () => {
    expect(normalizeUsername(" @adahan ")).toBe("adahan");
  });
  it("keeps empty empty", () => {
    expect(normalizeUsername("")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { resolveLeadsView } from "./leadsView";

describe("resolveLeadsView", () => {
  it("url parameter wins over the stored choice", () => expect(resolveLeadsView("list", "board")).toBe("list"));
  it("falls back to the stored choice", () => expect(resolveLeadsView(null, "list")).toBe("list"));
  it("defaults to the board", () => expect(resolveLeadsView(null, null)).toBe("board"));
  it("ignores garbage", () => {
    expect(resolveLeadsView("мусор", null)).toBe("board");
    expect(resolveLeadsView("мусор", "list")).toBe("list");
  });
});

import { describe, expect, it } from "vitest";
import { salesDeptTarget, withQuery } from "./redirectQuery";

describe("withQuery", () => {
  it("keeps the incoming query", () => expect(withQuery("/sales/today", { assignee: "none" })).toBe("/sales/today?assignee=none"));
  it("no query, no question mark", () => expect(withQuery("/sales/today", {})).toBe("/sales/today"));
  it("forced values come first and win", () => {
    expect(withQuery("/leads", { overdue: "true" }, { view: "board" })).toBe("/leads?view=board&overdue=true");
    expect(withQuery("/leads", { view: "list", no_task: "true" }, { view: "board" })).toBe("/leads?view=board&no_task=true");
  });
  it("repeats array values and skips undefined", () =>
    expect(withQuery("/x", { a: ["1", "2"], b: undefined })).toBe("/x?a=1&a=2"));
});

describe("salesDeptTarget", () => {
  it("meetings=1 goes to the meetings page", () => expect(salesDeptTarget({ meetings: "1" })).toBe("/sales/meetings"));
  it("everything else goes to the metrics page", () => {
    expect(salesDeptTarget({})).toBe("/sales/metrics");
    expect(salesDeptTarget({ meetings: "0" })).toBe("/sales/metrics");
  });
});

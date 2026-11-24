import { describe, expect, it } from "vitest";
import { buildLeadPatch } from "./leadPatch";

// Backend text columns are NOT NULL (default ""), so an emptied text field is sent as "",
// not null. Only the nullable columns (employees_count, *_id) become null.
describe("buildLeadPatch", () => {
  it("empty email -> empty string (column is not nullable)", () => {
    expect(buildLeadPatch("email", "")).toEqual({ email: "" });
    expect(buildLeadPatch("email", "  ")).toEqual({ email: "" });
  });
  it("trims text", () => {
    expect(buildLeadPatch("industry", "  IT ")).toEqual({ industry: "IT" });
  });
  it("parses deal_amount with spaces and nbsp", () => {
    expect(buildLeadPatch("deal_amount", "350 000")).toEqual({ deal_amount: 350000 });
    expect(buildLeadPatch("deal_amount", "350\u00a0000")).toEqual({ deal_amount: 350000 });
  });
  it("empty deal_amount -> 0 (backend ignores null)", () => {
    expect(buildLeadPatch("deal_amount", "")).toEqual({ deal_amount: 0 });
  });
  it("employees_count: number or null", () => {
    expect(buildLeadPatch("employees_count", "25")).toEqual({ employees_count: 25 });
    expect(buildLeadPatch("employees_count", "")).toEqual({ employees_count: null });
  });
  it("rejects garbage numbers", () => {
    expect(() => buildLeadPatch("deal_amount", "abc")).toThrow("Введите число");
    expect(() => buildLeadPatch("deal_amount", "-5")).toThrow("Введите число");
  });
  it("empty client_name throws", () => {
    expect(() => buildLeadPatch("client_name", "  ")).toThrow("Имя обязательно");
  });
  it("id fields -> number | null", () => {
    expect(buildLeadPatch("setter_id", "")).toEqual({ setter_id: null });
    expect(buildLeadPatch("closer_id", "7")).toEqual({ closer_id: 7 });
    expect(buildLeadPatch("source_id", "3")).toEqual({ source_id: 3 });
  });
  it("comment keeps inner newlines", () => {
    expect(buildLeadPatch("comment", "a\nb")).toEqual({ comment: "a\nb" });
  });
});

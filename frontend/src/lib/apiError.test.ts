import { describe, it, expect } from "vitest";
import { apiErrorMessage, existingLeadFromError } from "./apiError";

describe("apiErrorMessage", () => {
  it("passes a string detail through", () => {
    expect(apiErrorMessage("Нет прав", 403)).toBe("Нет прав");
  });
  it("uses message of an object detail (409 duplicate lead)", () => {
    const detail = { message: "Лид с таким номером уже существует", existing: { id: 3, client_name: "Айбек" } };
    expect(apiErrorMessage(detail, 409)).toBe("Лид с таким номером уже существует");
  });
  it("joins FastAPI validation errors", () => {
    expect(apiErrorMessage([{ msg: "field required" }, { msg: "bad" }], 422)).toBe("field required; bad");
  });
  it("falls back to HTTP status, never [object Object]", () => {
    expect(apiErrorMessage({ foo: 1 }, 500)).toBe("Ошибка запроса (HTTP 500)");
    expect(apiErrorMessage(undefined, 502)).toBe("Ошибка запроса (HTTP 502)");
    expect(apiErrorMessage("", 400)).toBe("Ошибка запроса (HTTP 400)");
  });
});

describe("existingLeadFromError", () => {
  it("reads the existing lead from a 409 error", () => {
    const e = Object.assign(new Error("dup"), {
      status: 409, detail: { message: "dup", existing: { id: 3, client_name: "Айбек", stage_id: 1 } },
    });
    expect(existingLeadFromError(e)).toEqual({ id: 3, client_name: "Айбек", stage_id: 1 });
    expect(existingLeadFromError(Object.assign(new Error("d"), { status: 409, detail: { existing: { id: 4 } } })))
      .toEqual({ id: 4, client_name: "", stage_id: null });
  });
  it("returns null for other errors", () => {
    expect(existingLeadFromError(new Error("x"))).toBeNull();
    expect(existingLeadFromError(Object.assign(new Error("x"), { status: 409, detail: "строка" }))).toBeNull();
    expect(existingLeadFromError("x")).toBeNull();
  });
});

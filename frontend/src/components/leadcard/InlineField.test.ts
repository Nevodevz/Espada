import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineField } from "./InlineField";

const noop = async () => {};

/** The <button>…</button> chunks of the rendered markup. */
function buttons(html: string): string[] {
  return html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

describe("InlineField view (spec §5.5: click on the value starts editing)", () => {
  it("the value itself is inside the edit button, so a click on it starts editing", () => {
    const html = renderToStaticMarkup(createElement(InlineField, { label: "Компания", value: "ООО Ромашка", onSave: noop }));
    const btns = buttons(html);
    expect(btns).toHaveLength(1);
    expect(btns[0]).toContain("ООО Ромашка");
    expect(btns[0]).toContain('type="button"');
  });
  it("the empty placeholder is clickable too", () => {
    const html = renderToStaticMarkup(createElement(InlineField, { label: "Компания", value: "", onSave: noop }));
    expect(buttons(html)[0]).toContain("добавить…");
  });
  it("keeps an accessible edit hint naming the field", () => {
    const html = renderToStaticMarkup(createElement(InlineField, { label: "Источник", value: "Instagram", kind: "select", onSave: noop }));
    expect(buttons(html)[0]).toContain("Изменить: Источник");
  });
});

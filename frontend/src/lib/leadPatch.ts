// Builds the PATCH /leads/{id} body for a single inline-edited field.
// Backend text columns are NOT NULL (default ""), so emptied text is sent as "";
// only employees_count and the *_id fields are nullable.

export type LeadEditableField =
  | "client_name" | "company_name" | "phone" | "whatsapp" | "instagram" | "email" | "address"
  | "website" | "industry" | "employees_count" | "source_id" | "service_id" | "setter_id"
  | "closer_id" | "deal_amount" | "comment" | "source_detail" | "content_ref" | "utm_source"
  | "utm_medium" | "utm_campaign" | "utm_content" | "external_lead_id";

const ID_FIELDS = new Set<LeadEditableField>(["source_id", "service_id", "setter_id", "closer_id"]);

function parseCount(raw: string): number | null {
  const s = raw.replace(/[\s\u00a0]/g, "");
  if (!s) return null;
  if (!/^\d+$/.test(s)) throw new Error("Введите число");
  return Number(s);
}

export function buildLeadPatch(field: LeadEditableField, raw: string): Record<string, unknown> {
  if (field === "deal_amount") return { deal_amount: parseCount(raw) ?? 0 };
  if (field === "employees_count") return { employees_count: parseCount(raw) };
  if (ID_FIELDS.has(field)) {
    const v = raw.trim();
    return { [field]: v ? Number(v) : null };
  }
  const text = raw.trim();
  if (field === "client_name" && !text) throw new Error("Имя обязательно");
  return { [field]: text };
}

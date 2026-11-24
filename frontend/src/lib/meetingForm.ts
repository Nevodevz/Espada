import type { Lead } from "./types";

export interface MeetingFormFromLead {
  lead_id: number;
  client_name: string;
  client_phone: string;
  setter_id: number | null;
}

/** Fields of the «new meeting» form that a picked lead fills in by itself. */
export function meetingFormFromLead(
  lead: Pick<Lead, "id" | "client_name" | "phone" | "setter_id">,
): MeetingFormFromLead {
  return {
    lead_id: lead.id,
    client_name: lead.client_name,
    client_phone: lead.phone || "",
    setter_id: lead.setter_id ?? null,
  };
}

/** Typed text counts as a phone number when it is mostly digits / + - ( ) and spaces. */
export function looksLikePhone(text: string): boolean {
  const t = text.trim();
  return /^[+\d][\d\s\-().+]*$/.test(t) && t.replace(/\D/g, "").length >= 5;
}

/** Body for `POST /leads` created from the text typed into the client picker. */
export function newClientPayload(
  text: string,
  setterId: number | null,
): { client_name: string; phone?: string; setter_id: number | null } {
  const t = text.trim();
  return looksLikePhone(t)
    ? { client_name: t, phone: t, setter_id: setterId }
    : { client_name: t, setter_id: setterId };
}

/**
 * Create the meeting, making a new lead first when the client was typed in.
 * The new lead's id is reported through `onLeadCreated` right away, so a retry
 * after a failed meeting reuses it instead of creating a second lead.
 */
export async function createMeetingForClient<M>(opts: {
  leadId: number | null;
  newClientText: string | null;
  setterId: number | null;
  createLead: (payload: ReturnType<typeof newClientPayload>) => Promise<{ id: number }>;
  createMeeting: (leadId: number | null) => Promise<M>;
  onLeadCreated: (leadId: number) => void;
}): Promise<M> {
  let leadId = opts.leadId;
  let leadJustCreated = false;
  if (leadId === null && opts.newClientText !== null) {
    const lead = await opts.createLead(newClientPayload(opts.newClientText, opts.setterId));
    leadId = lead.id;
    leadJustCreated = true;
    opts.onLeadCreated(lead.id);
  }
  try {
    return await opts.createMeeting(leadId);
  } catch (e) {
    if (leadJustCreated) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Клиент создан, но встреча не назначена: ${msg}`);
    }
    throw e;
  }
}

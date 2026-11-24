import { describe, expect, it } from "vitest";
import { createMeetingForClient, looksLikePhone, meetingFormFromLead, newClientPayload } from "./meetingForm";

describe("meetingFormFromLead", () => {
  it("copies phone and setter", () => {
    expect(meetingFormFromLead({ id: 5, client_name: "Асан", phone: "+996700111222", setter_id: 7 }))
      .toEqual({ lead_id: 5, client_name: "Асан", client_phone: "+996700111222", setter_id: 7 });
  });
  it("empty phone becomes empty string", () => {
    expect(meetingFormFromLead({ id: 1, client_name: "А", phone: null as unknown as string, setter_id: 2 }).client_phone).toBe("");
  });
  it("keeps null setter", () => {
    expect(meetingFormFromLead({ id: 1, client_name: "А", phone: "", setter_id: null }).setter_id).toBeNull();
  });
});

describe("new client payload", () => {
  it("detects phones", () => {
    expect(looksLikePhone("+996 700 111-222")).toBe(true);
    expect(looksLikePhone("Асан")).toBe(false);
  });
  it("puts a name into client_name", () => {
    expect(newClientPayload(" Асан ", 3)).toEqual({ client_name: "Асан", setter_id: 3 });
  });
  it("puts a phone into phone and keeps a placeholder name", () => {
    expect(newClientPayload("+996700111222", 3)).toEqual({ client_name: "+996700111222", phone: "+996700111222", setter_id: 3 });
  });
});

describe("createMeetingForClient", () => {
  it("does not create a second lead when retrying after a failed meeting", async () => {
    let leadCalls = 0;
    let picked: number | null = null;
    let meetingTries = 0;
    const run = () => createMeetingForClient({
      leadId: picked, newClientText: picked === null ? "Асан" : null, setterId: 1,
      createLead: async () => { leadCalls++; return { id: 42 }; },
      createMeeting: async (id) => { if (++meetingTries === 1) throw new Error("Занято"); return { lead: id }; },
      onLeadCreated: (id) => { picked = id; },
    });
    await expect(run()).rejects.toThrow("Клиент создан, но встреча не назначена: Занято");
    expect(await run()).toEqual({ lead: 42 });
    expect(leadCalls).toBe(1);
  });
});

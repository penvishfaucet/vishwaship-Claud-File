import { describe, expect, it } from "vitest";
import { decisionFromReply, parseWatiWebhook } from "./wati";

describe("WATI webhook parsing", () => {
  it("reads a button reply", () => {
    const p = parseWatiWebhook({ eventType: "message", waId: "919876543210", id: "m1", type: "button", buttonReply: { text: "Cancel Order", payload: "Cancel Order" } });
    expect(p.isReply).toBe(true);
    expect(p.waId).toBe("919876543210");
    expect(decisionFromReply(p.replyText)).toBe("cancel");
  });
  it("reads a delivery status", () => {
    const p = parseWatiWebhook({ eventType: "sentMessageDELIVERED", whatsappMessageId: "w9" });
    expect(p.deliveryStatus).toBe("delivered");
    expect(p.msgId).toBe("w9");
  });
  it("only accepts the two buttons", () => {
    expect(decisionFromReply("Confirm Order")).toBe("confirm");
    expect(decisionFromReply("maybe later")).toBeNull();
  });
});

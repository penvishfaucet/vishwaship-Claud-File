import { describe, expect, it } from "vitest";
import { parseAisensyWebhook } from "./aisensy";
import { decisionFromReply } from "./wati";

describe("AiSensy webhook parsing", () => {
  it("reads a buyer's button tap", () => {
    const p = parseAisensyWebhook({ topic: "message.sender.user", data: { message: { id: "m1", phone_number: "+91 98765 43210", message_type: "BUTTON", sender: "USER", message_content: { text: "Confirm Order" } } } });
    expect(p.isReply).toBe(true);
    expect(p.waId).toBe("919876543210");
    expect(decisionFromReply(p.replyText)).toBe("confirm");
  });
  it("reads a delivery status, not as a reply", () => {
    const p = parseAisensyWebhook({ topic: "message.status.updated", data: { message: { messageId: "w9", status: "DELIVERED" } } });
    expect(p.isReply).toBe(false);
    expect(p.deliveryStatus).toBe("delivered");
    expect(p.msgId).toBe("w9");
  });
  it("ignores our own outgoing messages", () => {
    const p = parseAisensyWebhook({ topic: "message.created", data: { message: { id: "m2", phone_number: "919876543210", sender: "BUSINESS", message_content: { text: "Cancel Order" } } } });
    expect(p.isReply).toBe(false);
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getNotionVerificationToken,
  getPageUnlocked,
  getPagePropertyUpdate,
  isNotionWebhookSignatureValid,
} from "../cms/notionWebhook.js";

describe("Notion connection webhook helpers", () => {
  it("reads the one-time verification token without treating it as an event", () => {
    expect(getNotionVerificationToken({ verification_token: "secret_verification" })).toBe("secret_verification");
    expect(getNotionVerificationToken({ verification_token: 42 })).toBeNull();
    expect(getNotionVerificationToken({ type: "page.properties_updated" })).toBeNull();
  });

  it("validates only correctly signed raw payloads", () => {
    const rawBody = '{"type":"page.properties_updated"}';
    const token = "notion-verification-token";
    const signature = `sha256=${createHmac("sha256", token).update(rawBody).digest("hex")}`;

    expect(isNotionWebhookSignatureValid(rawBody, signature, token)).toBe(true);
    expect(isNotionWebhookSignatureValid(rawBody, signature, "wrong-token")).toBe(false);
    expect(isNotionWebhookSignatureValid(rawBody, null, token)).toBe(false);
  });

  it("routes only page property-update events and preserves Notion property IDs", () => {
    expect(getPagePropertyUpdate({
      type: "page.properties_updated",
      entity: { type: "page", id: "page-123" },
      data: { updated_properties: ["%3Fabc", 42] },
    })).toEqual({ pageId: "page-123", updatedPropertyIds: ["%3Fabc"] });
    expect(getPagePropertyUpdate({
      type: "page.content_updated",
      entity: { type: "page", id: "page-123" },
      data: { updated_properties: ["%3Fabc"] },
    })).toBeNull();
  });

  it("routes only page-unlocked events", () => {
    expect(getPageUnlocked({
      type: "page.unlocked",
      entity: { type: "page", id: "page-123" },
    })).toEqual({ pageId: "page-123" });
    expect(getPageUnlocked({
      type: "page.locked",
      entity: { type: "page", id: "page-123" },
    })).toBeNull();
  });
});

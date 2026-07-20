import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isResendWebhookValid,
  parseSubscriberInput,
  renderNewsletterEmail,
  sendNewsletterForPageId,
} from "../newsletter/newsletterService.js";

describe("newsletter service helpers", () => {
  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.NOTION_API_KEY;
    vi.unstubAllGlobals();
  });

  it("validates required subscriber fields and discards honeypot submissions", () => {
    expect(parseSubscriberInput({ firstName: " Shayne ", lastName: "McGregor", email: "SHAYNE@example.com", whySubscribe: "More systems writing" })).toEqual({
      firstName: "Shayne",
      lastName: "McGregor",
      email: "shayne@example.com",
      whySubscribe: "More systems writing",
    });
    expect(() => parseSubscriberInput({ firstName: "Shayne", lastName: "McGregor", email: "shayne@example.com", website: "spam.example" })).toThrow("Invalid subscription request.");
  });

  it("validates Svix-signed Resend webhook payloads", () => {
    const rawBody = JSON.stringify({ type: "contact.updated", data: { email: "reader@example.com", unsubscribed: true } });
    const key = Buffer.from("newsletter-test-secret").toString("base64");
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${key}`;
    const id = "msg_test";
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
    const headers = new Headers({ "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` });

    expect(isResendWebhookValid(rawBody, headers)).toBe(true);
    headers.set("svix-signature", "v1,not-a-valid-signature");
    expect(isResendWebhookValid(rawBody, headers)).toBe(false);
  });

  it("renders an escaped, unsubscribe-enabled newsletter", () => {
    const html = renderNewsletterEmail({
      intro: "Hello <readers>",
      title: "A <better> cache",
      summary: "What changed.",
      slug: "better-cache",
      imageUrl: "https://images.example/cache.png",
      linkedinUrl: "https://www.linkedin.com/posts/example",
    });

    expect(html).toContain("Hello &lt;readers&gt;");
    expect(html).toContain("{{{RESEND_UNSUBSCRIBE_URL}}}");
    expect(html).toContain("https://shaynemcgregor.dev/blog/better-cache");
  });

  it("never creates a second broadcast for a page already marked sent", async () => {
    process.env.NOTION_API_KEY = "notion-test-key";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "post-123",
      properties: {
        "Newsletter State": { select: { name: "Sent" } },
        "Newsletter Broadcast ID": { rich_text: [{ plain_text: "broadcast-123" }] },
        "Newsletter Sent At": { date: { start: "2026-07-20T12:00:00.000Z" } },
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendNewsletterForPageId("post-123")).resolves.toEqual({ sent: false, broadcastId: "broadcast-123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("https://api.notion.com/v1/pages/post-123");
  });
});

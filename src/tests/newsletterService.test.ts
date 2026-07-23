import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmSubscription,
  isResendWebhookValid,
  parseSubscriberInput,
  renderNewsletterEmail,
  sendNewsletterForPageId,
} from "../newsletter/newsletterService.js";

describe("newsletter service helpers", () => {
  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.NOTION_API_KEY;
    delete process.env.NOTION_SUBSCRIBERS_DATABASE_ID;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_BLOG_UPDATES_SEGMENT_ID;
    delete process.env.RESEND_BLOG_UPDATES_TOPIC_ID;
    delete process.env.NEWSLETTER_ADMIN_EMAIL;
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

  it("alerts the owner only after a valid subscription confirmation", async () => {
    const token = "a".repeat(32);
    configureConfirmationEnv();
    const fetchMock = confirmationFetch(token, 200);
    vi.stubGlobal("fetch", fetchMock);

    await expect(confirmSubscription(token)).resolves.toBe(true);

    const alertCall = fetchMock.mock.calls.find(([url]) => String(url) === "https://api.resend.com/emails");
    expect(alertCall).toBeDefined();
    const body = JSON.parse(String(alertCall?.[1]?.body));
    expect(body).toMatchObject({
      to: ["owner@example.com"],
      subject: "New confirmed Notes from Shayne subscriber",
    });
    expect(body.html).toContain("Reader Example");
    expect(body.html).toContain("reader@example.com");
    expect(body.html).toContain("More systems writing");
    expect(alertCall?.[1]?.headers).toMatchObject({ "Idempotency-Key": "subscriber-confirmed-subscriber-123" });
  });

  it("does not alert for invalid confirmation tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(confirmSubscription("invalid")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirms the subscriber when the owner alert fails", async () => {
    const token = "b".repeat(32);
    configureConfirmationEnv();
    const fetchMock = confirmationFetch(token, 500);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await expect(confirmSubscription(token)).resolves.toBe(true);
    expect(errorSpy).toHaveBeenCalledWith("Confirmed subscriber alert failed", expect.objectContaining({ subscriberId: "subscriber-123" }));
  });
});

function configureConfirmationEnv() {
  process.env.NOTION_API_KEY = "notion-test-key";
  process.env.NOTION_SUBSCRIBERS_DATABASE_ID = "subscriber-data-source";
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.RESEND_BLOG_UPDATES_SEGMENT_ID = "segment-123";
  process.env.RESEND_BLOG_UPDATES_TOPIC_ID = "topic-123";
  process.env.NEWSLETTER_ADMIN_EMAIL = "owner@example.com";
}

function confirmationFetch(token: string, alertStatus: number) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    if (target === "https://api.notion.com/v1/databases/subscriber-data-source") return new Response(null, { status: 404 });
    if (target === "https://api.notion.com/v1/data_sources/subscriber-data-source/query") {
      return Response.json({ results: [subscriberPage(tokenHash)] });
    }
    if (target === "https://api.resend.com/contacts/reader%40example.com" && init?.method === "PATCH") return new Response(null, { status: 404 });
    if (target === "https://api.resend.com/contacts" && init?.method === "POST") return Response.json({ id: "contact-123" });
    if (target === "https://api.resend.com/contacts/reader%40example.com/segments/segment-123") return new Response(null, { status: 204 });
    if (target === "https://api.resend.com/contacts/reader%40example.com/topics") return new Response(null, { status: 204 });
    if (target === "https://api.notion.com/v1/pages/subscriber-123") return new Response(null, { status: 204 });
    if (target === "https://api.resend.com/emails") return alertStatus === 200 ? Response.json({ id: "email-123" }) : new Response(null, { status: alertStatus });
    throw new Error(`Unexpected request: ${target}`);
  });
}

function subscriberPage(tokenHash: string) {
  return {
    id: "subscriber-123",
    properties: {
      "First Name": { title: [{ plain_text: "Reader" }] },
      "Last Name": { rich_text: [{ plain_text: "Example" }] },
      Email: { email: "reader@example.com" },
      "Why Subscribe": { rich_text: [{ plain_text: "More systems writing" }] },
      Status: { select: { name: "Pending" } },
      "Confirmation Token Hash": { rich_text: [{ plain_text: tokenHash }] },
      "Confirmation Token Expires At": { date: { start: "2099-01-01T00:00:00.000Z" } },
      "Resend Contact ID": { rich_text: [] },
    },
  };
}

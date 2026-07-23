import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleCmsNotionWebhook } from "../cms/notionWebhookHandler.js";

describe("cms-notion-webhook function", () => {
  beforeEach(() => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = "test-verification-token";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues a valid page property event in the background", async () => {
    const body = JSON.stringify({
      type: "page.properties_updated",
      entity: { type: "page", id: "page-123" },
      data: { updated_properties: ["metadata-state"] },
    });
    const token = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN!;
    const signature = `sha256=${createHmac("sha256", token).update(body).digest("hex")}`;
    const mockedFetch = vi.mocked(fetch);
    mockedFetch.mockResolvedValue(new Response(null, { status: 202 }));

    const response = await handleCmsNotionWebhook(new Request("https://example.test", {
      method: "POST",
      headers: { "X-Notion-Signature": signature },
      body,
    }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: true });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(String(url)).toBe("https://example.test/.netlify/functions/cms-notion-webhook-background");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "X-CMS-Background-Token": token });
    expect(JSON.parse(String(init?.body))).toEqual({
      eventType: "page.properties_updated",
      pageId: "page-123",
      updatedPropertyIds: ["metadata-state"],
    });
  });

  it("queues a signed page-unlocked event in the background", async () => {
    const body = JSON.stringify({
      type: "page.unlocked",
      entity: { type: "page", id: "page-123" },
    });
    const token = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN!;
    const signature = `sha256=${createHmac("sha256", token).update(body).digest("hex")}`;
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));

    const response = await handleCmsNotionWebhook(new Request("https://example.test", {
      method: "POST",
      headers: { "X-Notion-Signature": signature },
      body,
    }));

    expect(response.status).toBe(202);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ eventType: "page.unlocked", pageId: "page-123" });
  });

  it("rejects unsigned events without queueing them", async () => {
    const response = await handleCmsNotionWebhook(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ type: "page.properties_updated" }),
    }));

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});

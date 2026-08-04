import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../resources/resourceGuideEnrichmentService.js", () => ({
  processResourceGuidePagePropertyUpdate: vi.fn(),
}));

import { handleResourceGuideNotionWebhook } from "../resources/resourceGuideNotionWebhookHandler.js";
import { createResourceGuideNotionWebhookBackgroundHandler } from "../resources/resourceGuideNotionWebhookBackgroundHandler.js";
import { processResourceGuidePagePropertyUpdate } from "../resources/resourceGuideEnrichmentService.js";

const token = "resource-guide-webhook-token";

describe("Resource Guide Notion webhook", () => {
  beforeEach(() => {
    process.env.RESOURCE_GUIDE_WEBHOOK_VERIFICATION_TOKEN = token;
    vi.restoreAllMocks();
    vi.mocked(processResourceGuidePagePropertyUpdate).mockReset();
  });

  it("accepts a signed property event and starts its protected worker", async () => {
    const body = JSON.stringify({ type: "page.properties_updated", entity: { type: "page", id: "resource-1" }, data: { updated_properties: ["state"] } });
    const signature = `sha256=${createHmac("sha256", token).update(body).digest("hex")}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));

    const response = await handleResourceGuideNotionWebhook(new Request("https://example.test/webhook", { method: "POST", headers: { "X-Notion-Signature": signature }, body }));
    expect(response.status).toBe(202);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.headers).toMatchObject({ "X-Resource-Guide-Background-Token": token });
    expect(JSON.parse(String(init?.body))).toEqual({ eventType: "page.properties_updated", pageId: "resource-1", updatedPropertyIds: ["state"] });
    vi.unstubAllGlobals();
  });

  it("rejects unsigned events", async () => {
    const response = await handleResourceGuideNotionWebhook(new Request("https://example.test", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
  });

  it("protects the worker and passes only property update jobs", async () => {
    const store = { delete: vi.fn() };
    const handler = createResourceGuideNotionWebhookBackgroundHandler(store);
    vi.mocked(processResourceGuidePagePropertyUpdate).mockResolvedValue({ actions: ["cacheInvalidated"] });
    const unauthorized = await handler(new Request("https://example.test", { method: "POST", body: "{}" }));
    expect(unauthorized.status).toBe(401);

    const response = await handler(new Request("https://example.test", {
      method: "POST", headers: { "X-Resource-Guide-Background-Token": token },
      body: JSON.stringify({ eventType: "page.properties_updated", pageId: "resource-1", updatedPropertyIds: ["public-title", 1] }),
    }));
    expect(response.status).toBe(200);
    expect(processResourceGuidePagePropertyUpdate).toHaveBeenCalledWith("resource-1", ["public-title"], store);
  });
});

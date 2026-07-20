import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cms/blogCmsService.js", () => ({
  processCmsPagePropertyUpdate: vi.fn(),
}));

import { handleCmsNotionWebhook } from "../cms/notionWebhookHandler.js";
import { processCmsPagePropertyUpdate } from "../cms/blogCmsService.js";

const mockedProcessUpdate = vi.mocked(processCmsPagePropertyUpdate);

describe("cms-notion-webhook function", () => {
  beforeEach(() => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = "test-verification-token";
    mockedProcessUpdate.mockReset();
  });

  it("dispatches a valid page property event", async () => {
    const body = JSON.stringify({
      type: "page.properties_updated",
      entity: { type: "page", id: "page-123" },
      data: { updated_properties: ["metadata-state"] },
    });
    const token = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN!;
    const signature = `sha256=${createHmac("sha256", token).update(body).digest("hex")}`;
    mockedProcessUpdate.mockResolvedValue({ actions: ["metadata"] });

    const response = await handleCmsNotionWebhook(new Request("https://example.test", {
      method: "POST",
      headers: { "X-Notion-Signature": signature },
      body,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actions: ["metadata"] });
    expect(mockedProcessUpdate).toHaveBeenCalledWith("page-123", ["metadata-state"]);
  });

  it("rejects unsigned events without dispatching them", async () => {
    const response = await handleCmsNotionWebhook(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ type: "page.properties_updated" }),
    }));

    expect(response.status).toBe(401);
    expect(mockedProcessUpdate).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cms/blogCmsService.js", () => ({
  processCmsPagePropertyUpdate: vi.fn(),
  processCmsPageUnlocked: vi.fn(),
}));

import { handleCmsNotionWebhookBackground } from "../cms/notionWebhookBackgroundHandler.js";
import { processCmsPagePropertyUpdate, processCmsPageUnlocked } from "../cms/blogCmsService.js";

const mockedProcessUpdate = vi.mocked(processCmsPagePropertyUpdate);
const mockedProcessUnlocked = vi.mocked(processCmsPageUnlocked);

describe("cms-notion-webhook background function", () => {
  beforeEach(() => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = "test-verification-token";
    mockedProcessUpdate.mockReset();
    mockedProcessUnlocked.mockReset();
  });

  it("runs an authorized queued CMS update", async () => {
    mockedProcessUpdate.mockResolvedValue({ actions: ["metadata"] });

    const response = await handleCmsNotionWebhookBackground(new Request("https://example.test", {
      method: "POST",
      headers: { "X-CMS-Background-Token": "test-verification-token" },
      body: JSON.stringify({ eventType: "page.properties_updated", pageId: "page-123", updatedPropertyIds: ["metadata-state"] }),
    }));

    expect(response.status).toBe(200);
    expect(mockedProcessUpdate).toHaveBeenCalledWith("page-123", ["metadata-state"]);
  });

  it("runs an authorized queued page-unlocked update", async () => {
    mockedProcessUnlocked.mockResolvedValue({ actions: ["publication"] });

    const response = await handleCmsNotionWebhookBackground(new Request("https://example.test", {
      method: "POST",
      headers: { "X-CMS-Background-Token": "test-verification-token" },
      body: JSON.stringify({ eventType: "page.unlocked", pageId: "page-123" }),
    }));

    expect(response.status).toBe(200);
    expect(mockedProcessUnlocked).toHaveBeenCalledWith("page-123");
  });

  it("rejects an unauthenticated background request", async () => {
    const response = await handleCmsNotionWebhookBackground(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ eventType: "page.properties_updated", pageId: "page-123", updatedPropertyIds: [] }),
    }));

    expect(response.status).toBe(401);
    expect(mockedProcessUpdate).not.toHaveBeenCalled();
  });
});

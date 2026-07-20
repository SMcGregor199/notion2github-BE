import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cms/blogCmsService.js", () => ({
  processCmsPagePropertyUpdate: vi.fn(),
}));

import { handleCmsNotionWebhookBackground } from "../cms/notionWebhookBackgroundHandler.js";
import { processCmsPagePropertyUpdate } from "../cms/blogCmsService.js";

const mockedProcessUpdate = vi.mocked(processCmsPagePropertyUpdate);

describe("cms-notion-webhook background function", () => {
  beforeEach(() => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = "test-verification-token";
    mockedProcessUpdate.mockReset();
  });

  it("runs an authorized queued CMS update", async () => {
    mockedProcessUpdate.mockResolvedValue({ actions: ["metadata"] });

    const response = await handleCmsNotionWebhookBackground(new Request("https://example.test", {
      method: "POST",
      headers: { "X-CMS-Background-Token": "test-verification-token" },
      body: JSON.stringify({ pageId: "page-123", updatedPropertyIds: ["metadata-state"] }),
    }));

    expect(response.status).toBe(200);
    expect(mockedProcessUpdate).toHaveBeenCalledWith("page-123", ["metadata-state"]);
  });

  it("rejects an unauthenticated background request", async () => {
    const response = await handleCmsNotionWebhookBackground(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ pageId: "page-123", updatedPropertyIds: [] }),
    }));

    expect(response.status).toBe(401);
    expect(mockedProcessUpdate).not.toHaveBeenCalled();
  });
});

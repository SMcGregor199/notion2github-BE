import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../cms/blogCmsService.js", () => ({
  CmsWorkflowError: class CmsWorkflowError extends Error {
    constructor(message: string, readonly status = 500) {
      super(message);
    }
  },
  isAuthorizedWebhook: vi.fn(),
  reconcileCmsPageLocks: vi.fn(),
}));

import { handleCmsReconcilePageLocks } from "../cms/cmsReconcilePageLocksHandler.js";
import { isAuthorizedWebhook, reconcileCmsPageLocks } from "../cms/blogCmsService.js";

const mockedAuthorization = vi.mocked(isAuthorizedWebhook);
const mockedReconciliation = vi.mocked(reconcileCmsPageLocks);

describe("cms-reconcile-page-locks function", () => {
  beforeEach(() => {
    process.env.CMS_WEBHOOK_SECRET = "test-secret";
    mockedAuthorization.mockReset();
    mockedReconciliation.mockReset();
  });

  it("requires the existing CMS secret and returns reconciliation counts", async () => {
    mockedAuthorization.mockReturnValue(true);
    mockedReconciliation.mockResolvedValue({ inspected: 3, locked: 1, unlocked: 1, unchanged: 1 });

    const response = await handleCmsReconcilePageLocks(new Request("https://example.test", {
      method: "POST",
      headers: { "X-CMS-Webhook-Secret": "test-secret" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ inspected: 3, locked: 1, unlocked: 1, unchanged: 1 });
    expect(mockedAuthorization).toHaveBeenCalledOnce();
    expect(mockedReconciliation).toHaveBeenCalledOnce();
  });

  it("rejects calls without a valid CMS secret", async () => {
    mockedAuthorization.mockReturnValue(false);

    const response = await handleCmsReconcilePageLocks(new Request("https://example.test", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mockedReconciliation).not.toHaveBeenCalled();
  });
});

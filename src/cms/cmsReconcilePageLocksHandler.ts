import {
  CmsWorkflowError,
  isAuthorizedWebhook,
  reconcileCmsPageLocks,
} from "./blogCmsService.js";

export async function handleCmsReconcilePageLocks(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  try {
    if (!isAuthorizedWebhook(request, process.env.CMS_WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    return Response.json(await reconcileCmsPageLocks());
  } catch (error) {
    const status = error instanceof CmsWorkflowError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unexpected CMS page-lock reconciliation error.";
    console.error("CMS page-lock reconciliation failed:", error);
    return new Response(message, { status });
  }
}

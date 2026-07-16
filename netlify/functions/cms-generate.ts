import type { Context } from "@netlify/functions";
import {
  CmsWorkflowError,
  extractCmsRecordId,
  initializeCmsMetadata,
  isAuthorizedWebhook,
} from "../../src/cms/blogCmsService.js";

export default async function cmsGenerate(request: Request, _context: Context): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  try {
    if (!isAuthorizedWebhook(request, process.env.CMS_WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const recordId = extractCmsRecordId(await request.json());
    if (!recordId) {
      return new Response("Missing CMS Record ID", { status: 400 });
    }

    const result = await initializeCmsMetadata(recordId);
    return Response.json(result, { status: result.skipped ? 200 : 201 });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

function workflowErrorResponse(error: unknown): Response {
  const status = error instanceof CmsWorkflowError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Unexpected CMS workflow error.";
  console.error("CMS metadata generation failed:", error);
  return new Response(message, { status });
}

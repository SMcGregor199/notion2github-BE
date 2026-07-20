import { processCmsPagePropertyUpdate } from "./blogCmsService.js";
import { isSharedSecretValid } from "./notionWebhook.js";

interface CmsBackgroundJobPayload {
  pageId?: unknown;
  updatedPropertyIds?: unknown;
}

export async function handleCmsNotionWebhookBackground(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (!isSharedSecretValid(
    request.headers.get("x-cms-background-token"),
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN,
  )) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: CmsBackgroundJobPayload;
  try {
    payload = await request.json() as CmsBackgroundJobPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (typeof payload.pageId !== "string" || !Array.isArray(payload.updatedPropertyIds)) {
    return new Response("Invalid CMS background job", { status: 400 });
  }

  const updatedPropertyIds = payload.updatedPropertyIds.filter((value): value is string => typeof value === "string");
  try {
    const result = await processCmsPagePropertyUpdate(payload.pageId, updatedPropertyIds);
    console.info("CMS background job completed", { pageId: payload.pageId, actions: result.actions });
    return Response.json(result);
  } catch (error) {
    console.error("CMS background job failed", { pageId: payload.pageId, error });
    return new Response("CMS background job failed", { status: 500 });
  }
}

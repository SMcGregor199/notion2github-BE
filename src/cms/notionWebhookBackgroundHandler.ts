import { processCmsPagePropertyUpdate, processCmsPageUnlocked } from "./blogCmsService.js";
import { isSharedSecretValid } from "./notionWebhook.js";

interface CmsBackgroundJobPayload {
  eventType?: unknown;
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
  if (typeof payload.pageId !== "string") {
    return new Response("Invalid CMS background job", { status: 400 });
  }

  try {
    const result = payload.eventType === "page.unlocked"
      ? await processCmsPageUnlocked(payload.pageId)
      : payload.eventType === "page.properties_updated" && Array.isArray(payload.updatedPropertyIds)
        ? await processCmsPagePropertyUpdate(
          payload.pageId,
          payload.updatedPropertyIds.filter((value): value is string => typeof value === "string"),
        )
        : null;
    if (!result) {
      return new Response("Invalid CMS background job", { status: 400 });
    }
    console.info("CMS background job completed", { pageId: payload.pageId, eventType: payload.eventType, actions: result.actions });
    return Response.json(result);
  } catch (error) {
    console.error("CMS background job failed", { pageId: payload.pageId, error });
    return new Response("CMS background job failed", { status: 500 });
  }
}

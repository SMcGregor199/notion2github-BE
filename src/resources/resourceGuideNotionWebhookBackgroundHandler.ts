import { isSharedSecretValid } from "../cms/notionWebhook.js";
import { processResourceGuidePagePropertyUpdate } from "./resourceGuideEnrichmentService.js";
import type { ResourceGuideStore } from "./types.js";

export function createResourceGuideNotionWebhookBackgroundHandler(store: Pick<ResourceGuideStore, "delete">) {
  return async function handleResourceGuideNotionWebhookBackground(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    if (!isSharedSecretValid(
      request.headers.get("x-resource-guide-background-token"),
      process.env.RESOURCE_GUIDE_WEBHOOK_VERIFICATION_TOKEN,
    )) return new Response("Unauthorized", { status: 401 });

    let payload: { eventType?: unknown; pageId?: unknown; updatedPropertyIds?: unknown };
    try {
      payload = await request.json() as { eventType?: unknown; pageId?: unknown; updatedPropertyIds?: unknown };
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (payload.eventType !== "page.properties_updated" || typeof payload.pageId !== "string" || !Array.isArray(payload.updatedPropertyIds)) {
      return new Response("Invalid Resource Guide background job", { status: 400 });
    }

    try {
      const result = await processResourceGuidePagePropertyUpdate(
        payload.pageId,
        payload.updatedPropertyIds.filter((value): value is string => typeof value === "string"),
        store,
      );
      console.info("Resource Guide background job completed", { pageId: payload.pageId, actions: result.actions });
      return Response.json(result);
    } catch (error) {
      console.error("Resource Guide background job failed", { pageId: payload.pageId, error });
      return new Response("Resource Guide background job failed", { status: 500 });
    }
  };
}

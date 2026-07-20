import {
  getNotionVerificationToken,
  getPagePropertyUpdate,
  isNotionWebhookSignatureValid,
} from "./notionWebhook.js";
import { processCmsPagePropertyUpdate } from "./blogCmsService.js";

export async function handleCmsNotionWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const verificationToken = getNotionVerificationToken(payload);
  if (verificationToken) {
    console.info("Notion webhook verification token received:", verificationToken);
    return new Response("Verification token received", { status: 200 });
  }

  if (!isNotionWebhookSignatureValid(
    rawBody,
    request.headers.get("x-notion-signature"),
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN,
  )) {
    return new Response("Unauthorized", { status: 401 });
  }

  const update = getPagePropertyUpdate(payload);
  if (!update) {
    return Response.json({ actions: [] });
  }

  try {
    console.info("Notion CMS property update accepted", {
      pageId: update.pageId,
      updatedPropertyIds: update.updatedPropertyIds,
    });
    return Response.json(await processCmsPagePropertyUpdate(update.pageId, update.updatedPropertyIds));
  } catch (error) {
    console.error("Notion CMS webhook failed:", error);
    return new Response("CMS webhook processing failed", { status: 500 });
  }
}

import {
  getNotionVerificationToken,
  getPagePropertyUpdate,
  isNotionWebhookSignatureValid,
} from "./notionWebhook.js";

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
    const backgroundToken = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN;
    if (!backgroundToken) {
      throw new Error("NOTION_WEBHOOK_VERIFICATION_TOKEN is not configured.");
    }

    console.info("Notion CMS property update accepted", {
      pageId: update.pageId,
      updatedPropertyIds: update.updatedPropertyIds,
    });
    const jobResponse = await fetch(new URL("/.netlify/functions/cms-notion-webhook-background", request.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CMS-Background-Token": backgroundToken,
      },
      body: JSON.stringify(update),
    });
    if (!jobResponse.ok) {
      throw new Error(`Unable to start CMS background job (${jobResponse.status}).`);
    }

    return Response.json({ queued: true }, { status: 202 });
  } catch (error) {
    console.error("Notion CMS webhook failed:", error);
    return new Response("CMS webhook processing failed", { status: 500 });
  }
}

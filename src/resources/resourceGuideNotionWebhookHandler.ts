import { getNotionVerificationToken, getPagePropertyUpdate, isNotionWebhookSignatureValid } from "../cms/notionWebhook.js";

export async function handleResourceGuideNotionWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });

  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const verificationToken = getNotionVerificationToken(payload);
  if (verificationToken) {
    console.info("Resource Guide Notion webhook verification token received:", verificationToken);
    return new Response("Verification token received", { status: 200 });
  }
  const token = process.env.RESOURCE_GUIDE_WEBHOOK_VERIFICATION_TOKEN;
  if (!isNotionWebhookSignatureValid(rawBody, request.headers.get("x-notion-signature"), token)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const event = getPagePropertyUpdate(payload);
  if (!event) return Response.json({ actions: [] });
  try {
    if (!token) throw new Error("RESOURCE_GUIDE_WEBHOOK_VERIFICATION_TOKEN is not configured.");
    const response = await fetch(new URL("/.netlify/functions/resource-guide-notion-webhook-background", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Resource-Guide-Background-Token": token },
      body: JSON.stringify({ eventType: "page.properties_updated", ...event }),
    });
    if (!response.ok) throw new Error(`Unable to start Resource Guide background job (${response.status}).`);
    return Response.json({ queued: true }, { status: 202 });
  } catch (error) {
    console.error("Resource Guide Notion webhook failed", error);
    return new Response("Resource Guide webhook processing failed", { status: 500 });
  }
}

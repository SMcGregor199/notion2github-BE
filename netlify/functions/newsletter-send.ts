import { isAuthorizedWebhook, extractCmsRecordId } from "../../src/cms/blogCmsService.js";
import { NewsletterError, sendNewsletterForPageId } from "../../src/newsletter/newsletterService.js";

export default async function newsletterSend(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  try {
    if (!isAuthorizedWebhook(request, process.env.CMS_WEBHOOK_SECRET)) return new Response("Unauthorized", { status: 401 });
    const payload = await request.json() as { pageId?: unknown };
    const pageId = typeof payload.pageId === "string" ? payload.pageId : "";
    if (!pageId) {
      const recordId = extractCmsRecordId(payload);
      if (recordId) return new Response("Use the Notion connection webhook or provide a pageId.", { status: 400 });
      return new Response("Missing pageId", { status: 400 });
    }
    return Response.json(await sendNewsletterForPageId(pageId));
  } catch (error) {
    const status = error instanceof NewsletterError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Newsletter send failed.";
    console.error("Newsletter send failed:", error);
    return new Response(message, { status });
  }
}

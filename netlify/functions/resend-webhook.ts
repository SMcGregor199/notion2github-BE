import { handleResendWebhook, NewsletterError } from "../../src/newsletter/newsletterService.js";

export default async function resendWebhook(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  try {
    await handleResendWebhook(await request.text(), request.headers);
    return new Response(null, { status: 204 });
  } catch (error) {
    const status = error instanceof NewsletterError ? error.status : 500;
    if (status >= 500) console.error("Resend webhook failed:", error);
    return new Response(status === 401 ? "Unauthorized" : "Webhook processing failed", { status });
  }
}

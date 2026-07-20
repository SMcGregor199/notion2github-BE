import {
  createPendingSubscription,
  NewsletterError,
  parseSubscriberInput,
} from "../../src/newsletter/newsletterService.js";

const ALLOWED_METHODS = "POST, OPTIONS";

export default async function newsletterSubscribe(request: Request): Promise<Response> {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...cors, Allow: ALLOWED_METHODS } });
  if (!isAllowedOrigin(request)) return new Response("Forbidden", { status: 403, headers: cors });

  try {
    const input = parseSubscriberInput(await request.json());
    await createPendingSubscription(input);
    // Deliberately generic: do not reveal whether an address is already subscribed.
    return Response.json({ message: "Check your email to confirm your subscription." }, { status: 202, headers: cors });
  } catch (error) {
    const status = error instanceof NewsletterError ? error.status : 500;
    const message = error instanceof NewsletterError && status < 500 ? error.message : "We could not process that subscription. Please try again.";
    if (status >= 500) console.error("Newsletter subscribe failed:", error);
    return Response.json({ message }, { status, headers: cors });
  }
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === (process.env.NEWSLETTER_ALLOWED_ORIGIN || "https://shaynemcgregor.dev");
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return origin && isAllowedOrigin(request)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": ALLOWED_METHODS, "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : { Vary: "Origin" };
}

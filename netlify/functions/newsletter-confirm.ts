import { confirmSubscription } from "../../src/newsletter/newsletterService.js";

export default async function newsletterConfirm(request: Request): Promise<Response> {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  let result = "invalid";
  try {
    if (await confirmSubscription(token)) result = "confirmed";
  } catch (error) {
    // Confirmation responses remain non-revealing even when an integration is unavailable.
    console.error("Newsletter confirmation failed:", error);
  }
  const destination = new URL("/subscribe/confirmed", process.env.NEWSLETTER_SITE_URL || "https://shaynemcgregor.dev");
  destination.searchParams.set("result", result);
  return Response.redirect(destination, 303);
}

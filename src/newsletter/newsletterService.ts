import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
// @ts-expect-error This established image-cache utility is JavaScript-only.
import { createStableImageId, publicImageUrlForImageId, registerNotionImageSource } from "../../utils/notionPublicImages.js";

const NOTION_API_BASE = "https://api.notion.com/v1";
const RESEND_API_BASE = "https://api.resend.com";
const NOTION_VERSION = "2026-03-11";
const CONFIRMATION_TTL_MS = 48 * 60 * 60 * 1000;
let subscriberDataSourceIdPromise: Promise<string> | undefined;

export const SUBSCRIBER_PROPERTIES = {
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  whySubscribe: "Why Subscribe",
  status: "Status",
  consentAt: "Consent At",
  confirmedAt: "Confirmed At",
  confirmationTokenHash: "Confirmation Token Hash",
  confirmationTokenExpiresAt: "Confirmation Token Expires At",
  resendContactId: "Resend Contact ID",
  source: "Source",
} as const;

export const NEWSLETTER_PROPERTIES = {
  intro: "Newsletter Intro",
  linkedinUrl: "LinkedIn Discussion URL",
  state: "Newsletter State",
  sentAt: "Newsletter Sent At",
  error: "Newsletter Error",
  broadcastId: "Newsletter Broadcast ID",
} as const;

export type SubscriberStatus = "Pending" | "Subscribed" | "Unsubscribed" | "Bounced";
export type NewsletterState = "Draft" | "Queued" | "Sending" | "Sent" | "Failed";

export class NewsletterError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

interface NotionPage {
  id: string;
  properties: Record<string, Record<string, unknown>>;
}

interface SubscriberInput {
  firstName: string;
  lastName: string;
  email: string;
  whySubscribe: string;
}

interface SubscriberRecord extends SubscriberInput {
  id: string;
  status: SubscriberStatus | "";
  tokenHash: string;
  tokenExpiresAt: string;
  resendContactId: string;
}

export function parseSubscriberInput(value: unknown): SubscriberInput {
  if (!value || typeof value !== "object") throw new NewsletterError("Invalid subscription request.", 400);
  const input = value as Record<string, unknown>;
  const firstName = normalizeText(input.firstName, 100);
  const lastName = normalizeText(input.lastName, 100);
  const email = normalizeEmail(input.email);
  const whySubscribe = normalizeText(input.whySubscribe, 1_000);
  const honeypot = normalizeText(input.website, 200);
  if (honeypot) throw new NewsletterError("Invalid subscription request.", 400);
  if (!firstName || !lastName || !email) throw new NewsletterError("Please provide your first name, last name, and a valid email address.", 400);
  return { firstName, lastName, email, whySubscribe };
}

export async function createPendingSubscription(input: SubscriberInput): Promise<void> {
  const existing = await findSubscriberByEmail(input.email);
  if (existing?.status === "Subscribed") {
    await updateSubscriber(existing.id, subscriberProperties(input, { source: "Website" }));
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CONFIRMATION_TTL_MS).toISOString();
  const properties = subscriberProperties(input, {
    status: "Pending",
    consentAt: new Date().toISOString(),
    tokenHash: hashToken(token),
    tokenExpiresAt: expiresAt,
    source: "Website",
    resendContactId: existing?.resendContactId || "",
  });
  if (existing) await updateSubscriber(existing.id, properties);
  else await createSubscriber(properties);

  await sendConfirmationEmail(input, token);
}

export async function confirmSubscription(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{30,200}$/.test(token)) return false;
  const subscriber = await findSubscriberByTokenHash(hashToken(token));
  if (!subscriber || subscriber.status !== "Pending" || !isFutureDate(subscriber.tokenExpiresAt)) return false;

  const resendContactId = await syncConfirmedContact(subscriber);
  const confirmedAt = new Date().toISOString();
  await updateSubscriber(subscriber.id, {
    [SUBSCRIBER_PROPERTIES.status]: selectProperty("Subscribed"),
    [SUBSCRIBER_PROPERTIES.confirmedAt]: dateProperty(confirmedAt),
    [SUBSCRIBER_PROPERTIES.confirmationTokenHash]: richTextProperty(""),
    [SUBSCRIBER_PROPERTIES.confirmationTokenExpiresAt]: dateProperty(""),
    [SUBSCRIBER_PROPERTIES.resendContactId]: richTextProperty(resendContactId),
  });
  await sendOwnerConfirmationAlert(subscriber, confirmedAt);
  return true;
}

export async function sendNewsletterForPageId(pageId: string): Promise<{ sent: boolean; broadcastId?: string }> {
  const page = await getNotionPage(pageId);
  const state = getSelect(page, NEWSLETTER_PROPERTIES.state) as NewsletterState | "";
  const existingBroadcastId = getRichText(page, NEWSLETTER_PROPERTIES.broadcastId);
  const sentAt = getDate(page, NEWSLETTER_PROPERTIES.sentAt);
  if (state === "Sent" || sentAt || existingBroadcastId) {
    if (state !== "Sent") await updateNotionPage(page.id, { [NEWSLETTER_PROPERTIES.state]: selectProperty("Sent") });
    return { sent: false, broadcastId: existingBroadcastId || undefined };
  }
  if (state !== "Queued") return { sent: false };

  const intro = getRichText(page, NEWSLETTER_PROPERTIES.intro);
  const linkedinUrl = getUrl(page, NEWSLETTER_PROPERTIES.linkedinUrl);
  const title = getTitle(page, "Name");
  const summary = getRichText(page, "Summary");
  const slug = getRichText(page, "Slug");
  const imageSourceUrl = getFileUrl(page, "Feature Image");
  if (!intro || !isHttpUrl(linkedinUrl) || !title || !summary || !slug || !imageSourceUrl) {
    const message = "Newsletter needs an intro, LinkedIn discussion URL, title, summary, slug, and feature image before sending.";
    await recordNewsletterFailure(page.id, message);
    throw new NewsletterError(message, 422);
  }

  await updateNotionPage(page.id, {
    [NEWSLETTER_PROPERTIES.state]: selectProperty("Sending"),
    [NEWSLETTER_PROPERTIES.error]: richTextProperty(""),
  });

  try {
    const imageUrl = await newsletterImageUrl(page);
    if (!imageUrl) throw new NewsletterError("BACKEND_ORIGIN is required to include the feature image in newsletter delivery.", 500);
    const html = renderNewsletterEmail({ intro, title, summary, slug, imageUrl, linkedinUrl });
    const broadcast = await resendRequest<{ id?: string }>("/broadcasts", {
      method: "POST",
      headers: { "Idempotency-Key": `newsletter-${page.id}` },
      body: JSON.stringify({
        segment_id: requiredEnv("RESEND_BLOG_UPDATES_SEGMENT_ID"),
        topic_id: requiredEnv("RESEND_BLOG_UPDATES_TOPIC_ID"),
        from: process.env.RESEND_FROM_EMAIL || "Shayne McGregor <updates@shaynemcgregor.dev>",
        reply_to: process.env.RESEND_REPLY_TO || "updates@shaynemcgregor.dev",
        subject: title,
        html,
      }),
    });
    if (!broadcast?.id) throw new NewsletterError("Resend did not return a broadcast ID.", 502);
    const broadcastId = broadcast.id;
    await updateNotionPage(page.id, { [NEWSLETTER_PROPERTIES.broadcastId]: richTextProperty(broadcastId) });
    await resendRequest(`/broadcasts/${encodeURIComponent(broadcastId)}/send`, { method: "POST", body: "{}" });
    await updateNotionPage(page.id, {
      [NEWSLETTER_PROPERTIES.state]: selectProperty("Sent"),
      [NEWSLETTER_PROPERTIES.sentAt]: dateProperty(new Date().toISOString()),
      [NEWSLETTER_PROPERTIES.error]: richTextProperty(""),
    });
    return { sent: true, broadcastId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Newsletter send failed.";
    await recordNewsletterFailure(page.id, message).catch(() => undefined);
    throw error;
  }
}

export async function handleResendWebhook(rawBody: string, headers: Headers): Promise<void> {
  if (!isResendWebhookValid(rawBody, headers)) throw new NewsletterError("Unauthorized", 401);
  const event = JSON.parse(rawBody) as { type?: unknown; data?: Record<string, unknown> };
  const type = String(event.type || "");
  const data = event.data || {};
  const email = webhookEmail(data);
  if (!email) return;

  if (type === "contact.updated" && data.unsubscribed === true) {
    await updateSubscriberStatusByEmail(email, "Unsubscribed");
  } else if (type === "email.bounced" && isPermanentBounce(data)) {
    await updateSubscriberStatusByEmail(email, "Bounced");
  }
}

export function isResendWebhookValid(rawBody: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!secret || !id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() - Number(timestamp) * 1_000) > 5 * 60 * 1_000) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return signature.split(" ").some((entry) => {
    const value = entry.startsWith("v1,") ? entry.slice(3) : "";
    const expectedBuffer = Buffer.from(expected);
    const valueBuffer = Buffer.from(value);
    return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
  });
}

export function renderNewsletterEmail(input: { intro: string; title: string; summary: string; slug: string; imageUrl: string; linkedinUrl: string }): string {
  const siteUrl = (process.env.NEWSLETTER_SITE_URL || "https://shaynemcgregor.dev").replace(/\/$/, "");
  const articleUrl = `${siteUrl}/blog/${encodeURIComponent(input.slug)}`;
  const image = isHttpUrl(input.imageUrl) ? `<img src="${escapeHtml(input.imageUrl)}" alt="" style="width:100%;border-radius:12px;display:block" />` : "";
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;color:#111827;font-family:Arial,sans-serif"><main style="max-width:640px;margin:0 auto;padding:32px 20px"><p style="white-space:pre-line;font-size:17px;line-height:1.65">${escapeHtml(input.intro)}</p>${image}<h1 style="font-size:30px;line-height:1.2"><a href="${escapeHtml(articleUrl)}" style="color:#111827">${escapeHtml(input.title)}</a></h1><p style="font-size:17px;line-height:1.65">${escapeHtml(input.summary)}</p><p><a href="${escapeHtml(articleUrl)}" style="display:inline-block;background:#d86f44;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">Read the article</a></p><p style="font-size:16px;line-height:1.65">Want to discuss it? <a href="${escapeHtml(input.linkedinUrl)}">Join the conversation on LinkedIn</a>.</p><hr style="border:0;border-top:1px solid #dbe2ea;margin:32px 0" /><p style="font-size:12px;line-height:1.5;color:#64748b">You received this because you subscribed to Notes from Shayne. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>.</p></main></body></html>`;
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function normalizeEmail(value: unknown): string {
  const email = normalizeText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function isFutureDate(value: string): boolean { return Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now(); }
function isHttpUrl(value: string): boolean { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw new NewsletterError(`${name} is not configured.`, 500); return value; }

function subscriberProperties(input: SubscriberInput, extra: { status?: SubscriberStatus; consentAt?: string; tokenHash?: string; tokenExpiresAt?: string; resendContactId?: string; source?: string }): Record<string, unknown> {
  return {
    [SUBSCRIBER_PROPERTIES.firstName]: titleProperty(input.firstName),
    [SUBSCRIBER_PROPERTIES.lastName]: richTextProperty(input.lastName),
    [SUBSCRIBER_PROPERTIES.email]: { email: input.email },
    [SUBSCRIBER_PROPERTIES.whySubscribe]: richTextProperty(input.whySubscribe),
    ...(extra.status ? { [SUBSCRIBER_PROPERTIES.status]: selectProperty(extra.status) } : {}),
    ...(extra.consentAt ? { [SUBSCRIBER_PROPERTIES.consentAt]: dateProperty(extra.consentAt) } : {}),
    ...(extra.tokenHash !== undefined ? { [SUBSCRIBER_PROPERTIES.confirmationTokenHash]: richTextProperty(extra.tokenHash) } : {}),
    ...(extra.tokenExpiresAt !== undefined ? { [SUBSCRIBER_PROPERTIES.confirmationTokenExpiresAt]: dateProperty(extra.tokenExpiresAt) } : {}),
    ...(extra.resendContactId !== undefined ? { [SUBSCRIBER_PROPERTIES.resendContactId]: richTextProperty(extra.resendContactId) } : {}),
    ...(extra.source ? { [SUBSCRIBER_PROPERTIES.source]: selectProperty(extra.source) } : {}),
  };
}

function titleProperty(content: string) { return { title: content ? [{ type: "text", text: { content } }] : [] }; }
function richTextProperty(content: string) { return { rich_text: content ? [{ type: "text", text: { content } }] : [] }; }
function selectProperty(name: string) { return { select: { name } }; }
function dateProperty(start: string) { return { date: start ? { start } : null }; }

async function findSubscriberByEmail(email: string): Promise<SubscriberRecord | null> {
  return findSubscriber({ property: SUBSCRIBER_PROPERTIES.email, email: { equals: email } });
}
async function findSubscriberByTokenHash(tokenHash: string): Promise<SubscriberRecord | null> {
  return findSubscriber({ property: SUBSCRIBER_PROPERTIES.confirmationTokenHash, rich_text: { equals: tokenHash } });
}
async function findSubscriber(filter: Record<string, unknown>): Promise<SubscriberRecord | null> {
  const response = await notionRequest<{ results?: NotionPage[] }>(`/data_sources/${await subscriberDataSourceId()}/query`, { method: "POST", body: JSON.stringify({ page_size: 1, filter }) });
  const page = response.results?.[0];
  return page ? subscriberFromPage(page) : null;
}
async function createSubscriber(properties: Record<string, unknown>): Promise<void> {
  await notionRequest("/pages", { method: "POST", body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: await subscriberDataSourceId() }, properties }) });
}
async function updateSubscriber(id: string, properties: Record<string, unknown>): Promise<void> { await updateNotionPage(id, properties); }
async function updateSubscriberStatusByEmail(email: string, status: SubscriberStatus): Promise<void> {
  const subscriber = await findSubscriberByEmail(email);
  if (subscriber && subscriber.status !== status) await updateSubscriber(subscriber.id, { [SUBSCRIBER_PROPERTIES.status]: selectProperty(status) });
}
function subscriberDataSourceId(): Promise<string> {
  subscriberDataSourceIdPromise ??= resolveSubscriberDataSourceId();
  return subscriberDataSourceIdPromise;
}
async function resolveSubscriberDataSourceId(): Promise<string> {
  const configured = requiredEnv("NOTION_SUBSCRIBERS_DATABASE_ID").replace(/^collection:\/\//, "");
  const response = await fetch(`${NOTION_API_BASE}/databases/${encodeURIComponent(configured)}`, {
    headers: { Authorization: `Bearer ${requiredEnv("NOTION_API_KEY")}`, "Notion-Version": NOTION_VERSION },
  });
  if (response.status === 404) return configured;
  if (!response.ok) throw new NewsletterError(`Notion API request failed (${response.status}).`, 502);
  const database = await response.json() as { data_sources?: Array<{ id?: unknown }> };
  return typeof database.data_sources?.[0]?.id === "string" ? database.data_sources[0].id : configured;
}
function subscriberFromPage(page: NotionPage): SubscriberRecord {
  return { id: page.id, firstName: getTitle(page, SUBSCRIBER_PROPERTIES.firstName), lastName: getRichText(page, SUBSCRIBER_PROPERTIES.lastName), email: normalizeEmail(getEmail(page, SUBSCRIBER_PROPERTIES.email)), whySubscribe: getRichText(page, SUBSCRIBER_PROPERTIES.whySubscribe), status: getSelect(page, SUBSCRIBER_PROPERTIES.status) as SubscriberStatus | "", tokenHash: getRichText(page, SUBSCRIBER_PROPERTIES.confirmationTokenHash), tokenExpiresAt: getDate(page, SUBSCRIBER_PROPERTIES.confirmationTokenExpiresAt), resendContactId: getRichText(page, SUBSCRIBER_PROPERTIES.resendContactId) };
}

async function syncConfirmedContact(subscriber: SubscriberRecord): Promise<string> {
  const contact = await resendRequest<{ id?: string }>(`/contacts/${encodeURIComponent(subscriber.email)}`, { method: "PATCH", body: JSON.stringify({ first_name: subscriber.firstName, last_name: subscriber.lastName, unsubscribed: false }) }, true);
  let contactId = contact?.id || subscriber.resendContactId;
  if (!contact) {
    const created = await resendRequest<{ id?: string }>("/contacts", { method: "POST", body: JSON.stringify({ email: subscriber.email, first_name: subscriber.firstName, last_name: subscriber.lastName, unsubscribed: false, segments: [{ id: requiredEnv("RESEND_BLOG_UPDATES_SEGMENT_ID") }], topics: [{ id: requiredEnv("RESEND_BLOG_UPDATES_TOPIC_ID"), subscription: "opt_in" }] }) });
    contactId = created?.id || "";
  }
  await resendRequest(`/contacts/${encodeURIComponent(subscriber.email)}/segments/${encodeURIComponent(requiredEnv("RESEND_BLOG_UPDATES_SEGMENT_ID"))}`, { method: "POST", body: "{}" });
  await resendRequest(`/contacts/${encodeURIComponent(subscriber.email)}/topics`, { method: "PATCH", body: JSON.stringify([{ id: requiredEnv("RESEND_BLOG_UPDATES_TOPIC_ID"), subscription: "opt_in" }]) });
  return contactId;
}

async function sendConfirmationEmail(input: SubscriberInput, token: string): Promise<void> {
  const base = requiredEnv("NEWSLETTER_CONFIRMATION_BASE_URL");
  const url = `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
  await resendRequest("/emails", { method: "POST", headers: { "Idempotency-Key": `confirm-${hashToken(token)}` }, body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "Shayne McGregor <updates@shaynemcgregor.dev>", reply_to: process.env.RESEND_REPLY_TO || "updates@shaynemcgregor.dev", to: [input.email], subject: "Confirm your subscription to Notes from Shayne", html: `<p>Hi ${escapeHtml(input.firstName)},</p><p>Please confirm that you want to receive Notes from Shayne.</p><p><a href="${escapeHtml(url)}">Confirm subscription</a></p><p>If you did not request this, you can ignore this email.</p>` }) });
}

async function sendOwnerConfirmationAlert(subscriber: SubscriberRecord, confirmedAt: string): Promise<void> {
  const recipient = normalizeEmail(process.env.NEWSLETTER_ADMIN_EMAIL);
  if (!recipient) {
    console.warn("Confirmed subscriber alert skipped: NEWSLETTER_ADMIN_EMAIL is not configured.");
    return;
  }

  const interests = subscriber.whySubscribe
    ? `<p><strong>Interested in:</strong><br>${escapeHtml(subscriber.whySubscribe)}</p>`
    : "";
  const html = `<p>A reader confirmed their subscription to Notes from Shayne.</p><p><strong>Name:</strong> ${escapeHtml(`${subscriber.firstName} ${subscriber.lastName}`.trim())}<br><strong>Email:</strong> ${escapeHtml(subscriber.email)}<br><strong>Confirmed:</strong> ${escapeHtml(confirmedAt)}</p>${interests}`;
  try {
    await resendRequest("/emails", {
      method: "POST",
      headers: { "Idempotency-Key": `subscriber-confirmed-${subscriber.id}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || "Shayne McGregor <updates@shaynemcgregor.dev>",
        reply_to: process.env.RESEND_REPLY_TO || "updates@shaynemcgregor.dev",
        to: [recipient],
        subject: "New confirmed Notes from Shayne subscriber",
        html,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Confirmed subscriber alert failed", { subscriberId: subscriber.id, message });
  }
}

async function getNotionPage(id: string): Promise<NotionPage> { return notionRequest<NotionPage>(`/pages/${encodeURIComponent(id)}`); }
async function updateNotionPage(id: string, properties: Record<string, unknown>): Promise<void> { await notionRequest(`/pages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ properties }) }); }
async function recordNewsletterFailure(id: string, message: string): Promise<void> { await updateNotionPage(id, { [NEWSLETTER_PROPERTIES.state]: selectProperty("Failed"), [NEWSLETTER_PROPERTIES.error]: richTextProperty(message.slice(0, 1_500)) }); }
async function notionRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${requiredEnv("NOTION_API_KEY")}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json", ...init.headers } });
  if (!response.ok) throw new NewsletterError(`Notion API request failed (${response.status}).`, 502);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
async function resendRequest<T = unknown>(path: string, init: RequestInit, allowNotFound = false): Promise<T | null> {
  const response = await fetch(`${RESEND_API_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`, "Content-Type": "application/json", ...init.headers } });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new NewsletterError(`Resend API request failed (${response.status}).`, 502);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function getProperty(page: NotionPage, name: string): Record<string, any> { return page.properties[name] || {}; }
function plainText(items: Array<{ plain_text?: string }> | undefined): string { return (items || []).map((item) => item.plain_text || "").join("").trim(); }
function getTitle(page: NotionPage, name: string): string { return plainText(getProperty(page, name).title); }
function getRichText(page: NotionPage, name: string): string { return plainText(getProperty(page, name).rich_text); }
function getEmail(page: NotionPage, name: string): string { return String(getProperty(page, name).email || ""); }
function getSelect(page: NotionPage, name: string): string { return String(getProperty(page, name).select?.name || ""); }
function getDate(page: NotionPage, name: string): string { return String(getProperty(page, name).date?.start || ""); }
function getUrl(page: NotionPage, name: string): string { return String(getProperty(page, name).url || ""); }
function getFileUrl(page: NotionPage, name: string): string { const file = getProperty(page, name).files?.[0]; return String(file?.file?.url || file?.external?.url || ""); }
async function newsletterImageUrl(page: NotionPage): Promise<string> {
  const sourceUrl = getFileUrl(page, "Feature Image");
  if (!sourceUrl) return "";
  const imageId = createStableImageId(page.id, "feature-image");
  await registerNotionImageSource(imageId, sourceUrl, { kind: "page-file", pageId: page.id, propertyName: "Feature Image" });
  return publicImageUrlForImageId(imageId);
}
function webhookEmail(data: Record<string, unknown>): string { const direct = normalizeEmail(data.email); if (direct) return direct; const to = Array.isArray(data.to) ? data.to.find((item) => typeof item === "string") : ""; return normalizeEmail(to); }
function isPermanentBounce(data: Record<string, unknown>): boolean { const type = String(data.bounce_type || data.bounceType || (data.bounce as Record<string, unknown> | undefined)?.type || "").toLowerCase(); return type === "permanent" || type === "hard"; }

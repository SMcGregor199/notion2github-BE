import { createHmac, timingSafeEqual } from "node:crypto";

export interface NotionPagePropertiesUpdatedEvent {
  type?: string;
  entity?: { id?: string; type?: string };
  data?: { updated_properties?: unknown };
}

export interface NotionPageUnlockedEvent {
  type?: string;
  entity?: { id?: string; type?: string };
}

export function getNotionVerificationToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const token = (payload as { verification_token?: unknown }).verification_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function isNotionWebhookSignatureValid(
  rawBody: string,
  signature: string | null,
  verificationToken: string | undefined,
): boolean {
  if (!signature || !verificationToken) return false;
  const expected = `sha256=${createHmac("sha256", verificationToken).update(rawBody).digest("hex")}`;
  return isSharedSecretValid(signature, expected);
}

export function isSharedSecretValid(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export function getPagePropertyUpdate(payload: unknown): { pageId: string; updatedPropertyIds: string[] } | null {
  const event = payload as NotionPagePropertiesUpdatedEvent | null;
  if (
    event?.type !== "page.properties_updated"
    || event.entity?.type !== "page"
    || typeof event.entity.id !== "string"
  ) {
    return null;
  }

  return {
    pageId: event.entity.id,
    // Notion has changed webhook payload versions over time. The page ID is
    // sufficient to reconcile publication/lock state, so treat an omitted or
    // unrecognised property list as an empty list rather than dropping the event.
    updatedPropertyIds: Array.isArray(event.data?.updated_properties)
      ? event.data.updated_properties.filter((value): value is string => typeof value === "string")
      : [],
  };
}

export function getPageUnlocked(payload: unknown): { pageId: string } | null {
  const event = payload as NotionPageUnlockedEvent | null;
  if (
    event?.type !== "page.unlocked"
    || event.entity?.type !== "page"
    || typeof event.entity.id !== "string"
  ) {
    return null;
  }

  return { pageId: event.entity.id };
}

import Crypto from "crypto";
import { getStore } from "@netlify/blobs";

const IMAGE_SOURCE_PREFIX = "content/notion-image-sources";

function getBackendOrigin() {
    return (process.env.BACKEND_ORIGIN || "").replace(/\/+$/, "");
}

function stableHash(value) {
    return Crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function sanitizeImageId(value) {
    return String(value || "image").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
}

export function createStableImageId(ownerId, sourceUrl) {
    return `${sanitizeImageId(ownerId)}-${stableHash(sourceUrl)}`;
}

export function notionImageSourceFingerprint(sourceUrl) {
    if (typeof sourceUrl !== "string" || !sourceUrl.trim()) {
        return "";
    }

    try {
        const parsed = new URL(sourceUrl);
        const isSignedUrl = [...parsed.searchParams.keys()].some((key) => key.toLowerCase().startsWith("x-amz-"));
        return stableHash(isSignedUrl ? `${parsed.origin}${parsed.pathname}` : parsed.toString());
    } catch {
        return stableHash(sourceUrl);
    }
}

export function imageSourceKey(imageId) {
    return `${IMAGE_SOURCE_PREFIX}/${sanitizeImageId(imageId)}.json`;
}

export function publicImageUrlForImageId(imageId) {
    const origin = getBackendOrigin();
    if (!origin || !imageId) {
        return "";
    }

    return `${origin}/.netlify/functions/notion-image?imageId=${encodeURIComponent(imageId)}`;
}

export function publicImageUrlForBlockId(blockId) {
    const origin = getBackendOrigin();
    if (!origin || !blockId) {
        return "";
    }

    return `${origin}/.netlify/functions/notion-image?blockId=${encodeURIComponent(blockId)}`;
}

export async function registerNotionImageSource(imageId, sourceUrl, reference = undefined) {
    if (!imageId || typeof sourceUrl !== "string" || !sourceUrl.trim()) {
        return null;
    }

    const store = getStore("content", { consistency: "strong" });
    const key = imageSourceKey(imageId);
    const existing = await store.get(key, { type: "json" });
    const record = {
        sourceUrl,
        sourceFingerprint: notionImageSourceFingerprint(sourceUrl),
        reference: reference || existing?.reference || null,
        updatedAt: new Date().toISOString(),
    };
    await store.setJSON(key, record);
    return record;
}

export async function readRegisteredNotionImageSource(imageId) {
    const record = await readRegisteredNotionImage(imageId);
    return record?.sourceUrl || "";
}

export async function readRegisteredNotionImage(imageId) {
    if (!imageId) {
        return null;
    }

    const store = getStore("content", { consistency: "strong" });
    const record = await store.get(imageSourceKey(imageId), { type: "json" });
    if (typeof record?.sourceUrl !== "string") {
        return null;
    }

    return {
        sourceUrl: record.sourceUrl,
        sourceFingerprint: typeof record.sourceFingerprint === "string"
            ? record.sourceFingerprint
            : notionImageSourceFingerprint(record.sourceUrl),
        reference: record.reference && typeof record.reference === "object" ? record.reference : null,
    };
}

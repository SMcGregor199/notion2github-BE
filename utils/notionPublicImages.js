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

export async function registerNotionImageSource(imageId, sourceUrl) {
    if (!imageId || typeof sourceUrl !== "string" || !sourceUrl.trim()) {
        return;
    }

    const store = getStore("content", { consistency: "strong" });
    await store.setJSON(imageSourceKey(imageId), {
        sourceUrl,
        updatedAt: new Date().toISOString(),
    });
}

export async function readRegisteredNotionImageSource(imageId) {
    if (!imageId) {
        return "";
    }

    const store = getStore("content", { consistency: "strong" });
    const record = await store.get(imageSourceKey(imageId), { type: "json" });
    return typeof record?.sourceUrl === "string" ? record.sourceUrl : "";
}

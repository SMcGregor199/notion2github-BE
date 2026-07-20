import { getStore } from "@netlify/blobs";
import sharp from "sharp";

export async function readCachedNotionImage(imageId, sourceFingerprint = "", { allowStale = false } = {}) {
    const store = getImageStore();
    const cached = await store.get(imageId, { type: "arrayBuffer" });
    if (!cached) {
        return null;
    }

    const metadata = await store.getMetadata(imageId);
    const cachedFingerprint = metadata?.metadata?.sourceFingerprint;
    if (sourceFingerprint && cachedFingerprint && cachedFingerprint !== sourceFingerprint) {
        if (!allowStale) {
            return null;
        }
        return {
            body: cached,
            contentType: metadata?.metadata?.contentType || "image/webp",
            stale: true,
        };
    }

    return {
        body: cached,
        contentType: metadata?.metadata?.contentType || "image/webp",
        stale: false,
    };
}

export async function cacheNotionImage(imageId, sourceUrl, sourceFingerprint = "") {
    const store = getImageStore();
    const response = await fetchWithRetry(sourceUrl);
    if (!response.ok) {
        throw new Error(`Source image request failed (${response.status}).`);
    }

    const input = Buffer.from(await response.arrayBuffer());
    const body = await sharp(input).toFormat("webp", { quality: 80 }).toBuffer();
    await store.set(imageId, body, {
        metadata: {
            contentType: "image/webp",
            sourceFingerprint,
        },
    });
    return { body, contentType: "image/webp" };
}

function getImageStore() {
    return getStore("images", { consistency: "strong" });
}

export async function prewarmNotionImage(imageId, sourceUrl, sourceFingerprint = "") {
    const cached = await readCachedNotionImage(imageId, sourceFingerprint);
    if (cached) {
        return cached;
    }

    return cacheNotionImage(imageId, sourceUrl, sourceFingerprint);
}

async function fetchWithRetry(sourceUrl) {
    let response;
    let lastError;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            response = await fetch(sourceUrl, { signal: AbortSignal.timeout(12_000) });
            if (response.ok || (response.status >= 400 && response.status < 500)) {
                return response;
            }
        } catch (error) {
            lastError = error;
        }

        if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }

    if (response) {
        return response;
    }
    throw lastError || new Error("Source image request failed.");
}

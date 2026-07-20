import { Client } from "@notionhq/client";
import {config} from "dotenv";
config();
import { getNotionImageUrl, getNotionImageUrlFromPageContent } from "../../utils/notionImage.js";
import { readRegisteredNotionImage, registerNotionImageSource } from "../../utils/notionPublicImages.js";
import { cacheNotionImage, readCachedNotionImage } from "../../utils/notionImageCache.js";
const NOTION_API_KEY = process.env.NOTION_API_KEY;
async function getPageContentById(pageId){
    try{
        const childPage = await notion.blocks.children.list({block_id: pageId});
        return childPage;
    }
    catch(err){
        console.error("Error fetching page content:", err);
        throw err;
    }

}


//initilizing the Notion client
const notion = new Client({
    auth: NOTION_API_KEY,
})

export default async (request,context)=> {
    try{
        const url = new URL(request.url);
        const blockId = url.searchParams.get("blockId");
        const imageId = url.searchParams.get("imageId");
    
        if (!blockId && !imageId) return new Response("Missing blockId or imageId", {status:400}); 
        const cacheKey = imageId || blockId;
        let registeredImage = imageId ? await readRegisteredNotionImage(imageId) : null;
        const cached = await readCachedNotionImage(cacheKey, registeredImage?.sourceFingerprint || "");
        if (cached) {
            return imageResponse(cached);
        }

        let imageFileUrl = registeredImage?.sourceUrl || (blockId ? await resolveLegacyNotionImageUrl(blockId) : "");

        if (!imageFileUrl) {
            return new Response("No image found", {
                status: 404,
                headers: {
                    "Content-Type": "text/plain",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        try {
            return imageResponse(await cacheNotionImage(cacheKey, imageFileUrl, registeredImage?.sourceFingerprint || ""));
        } catch (firstError) {
            if (registeredImage?.reference) {
                try {
                    const refreshedUrl = await resolveRegisteredNotionImageUrl(registeredImage.reference);
                    if (refreshedUrl) {
                        registeredImage = await registerNotionImageSource(imageId, refreshedUrl, registeredImage.reference);
                        try {
                            return imageResponse(await cacheNotionImage(cacheKey, refreshedUrl, registeredImage?.sourceFingerprint || ""));
                        } catch {
                            // A last-known-good image is preferable to a broken image while the source recovers.
                        }
                    }
                } catch {
                    // The stale Blob fallback below remains available if Notion is temporarily unavailable.
                }
            }

            const stale = await readCachedNotionImage(cacheKey, registeredImage?.sourceFingerprint || "", { allowStale: true });
            if (stale) {
                return imageResponse(stale);
            }
            throw firstError;
        }
    
    }catch(err){
        console.log(err);
        return new Response(`Internal error: ${err.message || err}`, {
            status: 500,
            headers: {
                "Content-Type": "text/plain"
            },
        });
    }
 
}

async function resolveLegacyNotionImageUrl(blockId) {
    const block = await notion.blocks.retrieve({ block_id: blockId });
    const directImageUrl = getNotionImageUrl(block);
    if (directImageUrl) {
        return directImageUrl;
    }

    const pageContent = await getPageContentById(blockId);
    return getNotionImageUrlFromPageContent(pageContent);
}

async function resolveRegisteredNotionImageUrl(reference) {
    if (reference.kind === "block-image" && reference.blockId) {
        const block = await notion.blocks.retrieve({ block_id: reference.blockId });
        return getNotionImageUrl(block);
    }

    if (!reference.pageId) {
        return "";
    }

    const page = await notion.pages.retrieve({ page_id: reference.pageId });
    if (reference.kind === "page-cover") {
        return getNotionFileUrl(page.cover);
    }
    if (reference.kind === "page-file" && reference.propertyName) {
        const property = page.properties?.[reference.propertyName];
        return getNotionFileUrl(property?.files?.[0]);
    }

    return "";
}

function getNotionFileUrl(fileValue) {
    if (!fileValue || typeof fileValue !== "object") {
        return "";
    }
    if (fileValue.type === "external") {
        return fileValue.external?.url || "";
    }
    if (fileValue.type === "file") {
        return fileValue.file?.url || "";
    }
    return fileValue.external?.url || fileValue.file?.url || "";
}

function imageResponse(image) {
    return new Response(image.body, {
        status: 200,
        headers: {
            "Content-Type": image.contentType,
            "Cache-Control": image.stale ? "public, max-age=300" : "public, max-age=31536000, immutable",
            "Access-Control-Allow-Origin": "*",
        },
    });
}

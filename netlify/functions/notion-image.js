import { getStore } from "@netlify/blobs";
import { Client } from "@notionhq/client";
import {config} from "dotenv";
config();
import sharp from "sharp";
import { getNotionImageUrl, getNotionImageUrlFromPageContent } from "../../utils/notionImage.js";
import { readRegisteredNotionImageSource } from "../../utils/notionPublicImages.js";
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


const store  = getStore("images", { consistency: "strong" });


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
        // If we have the raw binary image data cached, return it
        const cacheKey = imageId || blockId;
        const cached = await store.get(cacheKey, { type: "arrayBuffer" });
        const meta   = await store.getMetadata(cacheKey);
        if (cached) {
            return new Response(cached, {
                status: 200,
                headers: {
                "Content-Type": meta?.metadata?.contentType || "image/webp",
                "Cache-Control": "public, max-age=31536000, immutable",
                "Access-Control-Allow-Origin": "*"
                }
            });
        }

        // If we don't have the image cached, fetch it from Notion and cache it
        const imageFileUrl = imageId
            ? await readRegisteredNotionImageSource(imageId)
            : await resolveLegacyNotionImageUrl(blockId);

        if (!imageFileUrl) {
            return new Response("No image found", {
                status: 404,
                headers: {
                    "Content-Type": "text/plain",
                    "Access-Control-Allow-Origin": "*"
                }
            });
        }

        const res = await fetch(imageFileUrl);

        if (!res.ok) {
            return new Response(`Failed to fetch source image: ${res.status}`, {status: 502, headers: {"Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" }});
        }
        
        //getting the raw data from the response (binary data)
        const arrayBuf = await res.arrayBuffer();

        //turning it into a Node Buffer(something we can actually use and perform operations on)
        const buf = Buffer.from(arrayBuf);

        const optimizedBuf = await sharp(buf)
        .toFormat("webp", { quality: 80 })
        .toBuffer();

        await store.set(cacheKey, optimizedBuf, { metadata: { contentType: "image/webp" } });
            return new Response(optimizedBuf, {
                status: 200,
                headers: {
                    "Content-Type": "image/webp",
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "Access-Control-Allow-Origin": "*"
                }
            });
    
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

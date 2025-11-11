import { getStore } from "@netlify/blobs";
import { Client } from "@notionhq/client";
import {config} from "dotenv";
config();
import sharp from "sharp";
const NOTION_API_KEY = process.env.NOTION_API_KEY;
async function getPageContentById(pageId){
    try{
        const childPage = await notion.blocks.children.list({block_id: pageId});
        return childPage;
    }
    catch(err){
        console.error("Error fetching page content:", err);
    }

}

async function getPageImageUrlById(pageId){
    try{
        const pageContent = await getPageContentById(pageId);
        const imageObject = pageContent.results.find((block)=>block.hasOwnProperty("image"));
        
        return imageObject.image.file.url;
    }
    catch(err){
        console.log("Error fetching page image:", err);
    }
}


const store  = getStore({ name: "images",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_ACCESS_TOKEN
});


//initilizing the Notion client
const notion = new Client({
    auth: NOTION_API_KEY,
})

export default async (request,context)=> {
    try{
        const url = new URL(request.url);
        const blockId = url.searchParams.get("blockId");
    
        if (!blockId) return new Response("Missing blockId", {status:400}); 
        // If we have the raw binary image data cached, return it
        const cached = await store.get(blockId, { type: "arrayBuffer" });
        const meta   = await store.getMetadata(blockId);
        if (cached) {
            return new Response(cached, {
                status: 200,
                headers: {
                "Content-Type": meta?.contentType || "image/webp",
                "Cache-Control": "public, max-age=31536000, immutable",
                "Access-Control-Allow-Origin": "*"
                }
            });
        }

        // If we don't have the image cached, fetch it from Notion and cache it
        const imageFileUrl = await getPageImageUrlById(blockId);
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

        await store.set(blockId, optimizedBuf, { metadata: { contentType: "image/webp" } });
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
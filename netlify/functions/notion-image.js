import { getStore } from "@netlify/blobs";
import { Client } from "@notionhq/client";
import {config} from "dotenv";
config();
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

export async function handler(event) {
    try{
        const blockId = event.queryStringParameters.blockId;
        if (!blockId) return { statusCode: 400, body: "Missing blockId" };
        // If we have the raw binary image data cached, return it
        const cached = await store.get(blockId, { type: "arrayBuffer" });
        const meta   = await store.getMetadata(blockId);
        if (cached) {
            return {
                statusCode: 200,
                headers: {
                "Content-Type": meta?.contentType,
                "Cache-Control": "public, max-age=31536000, immutable",
                "Access-Control-Allow-Origin": "*"
                },
                body: Buffer.from(cached).toString("base64"),
                isBase64Encoded: true
            };
        }

        // If we don't have the image cached, fetch it from Notion and cache it
        const imageFileUrl = await getPageImageUrlById(blockId);
        const res = await fetch(imageFileUrl);
        const contentType = res.headers.get("content-type")
    
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        await store.set(blockId, buf, { metadata: { contentType } });
            return {
                statusCode: 200,
                headers: {
                    "Content-Type": contentType,
                    "Cache-Control": "public, max-age=31536000, immutable",
                    "Access-Control-Allow-Origin": "*"
                },
                body: buf.toString("base64"),
                isBase64Encoded: true
            };
    
    }catch(err){
        console.log(err);
            return {
      statusCode: 500,
      body: `Internal error: ${err.message || err}`,
    };
    }
 
}
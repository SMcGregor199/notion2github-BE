import { getStore } from "@netlify/blobs";
import {config} from "dotenv";
config();
import fetchAndStoreLatestData from "../../utils/fetchAndStoreLatestData";



export default async(request, context) => {

    try{

        if (request.method === "OPTIONS") {
            return {
                statusCode: 204,
                headers: {
                    "Access-Control-Allow-Origin": "https://shaynemcgregor.dev",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "If-None-Match",
                },
            };
        }
        const store = getStore({ name: "content", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_ACCESS_TOKEN });
        const manifest = await store.get("content/manifest.json", {type:"json"});
        if (!manifest) return { statusCode: 404, body: "manifest not found" };
        
        const version = await fetchAndStoreLatestData();
        const ifNoneMatch = request.headers.get("if-none-match");
        if (ifNoneMatch && ifNoneMatch === version) {
            return {
            statusCode: 304,
            headers: {
                "Access-Control-Allow-Origin": "https://shaynemcgregor.dev",
                ETag: version,
            },
            };
        }
        const body = await store.get(version,{type:"json"});
        return {
            statusCode: 200,
            headers: {
                "Access-Control-Allow-Origin": "https://shaynemcgregor.dev",
                "Content-Type": "application/json",
                "Cache-Control": "max-age=30, stale-while-revalidate=300",
                ETag: version,
            },
            body,
        }

      

    }
    catch(err){
        console.error("Error fetching blog data:", err);
        return {
            statusCode: 500,
            headers: {
                "Access-Control-Allow-Origin": "https://shaynemcgregor.dev",
            },
            body: `Internal error: ${err.message || err}`,
        };
    }
}
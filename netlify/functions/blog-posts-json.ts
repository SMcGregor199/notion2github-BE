import type {Context} from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (req:Request,context:Context) => {
    try{    
        const content = getStore({ name: "content", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_ACCESS_TOKEN });
        const manifest = await content.get("content/manifest.json", {type:"json"});
        if (!manifest) return new Response("manifest not found",{status:404});
        const version = manifest.current_key;
        const posts = await content.get(version,{type:"json"});
        return new Response(JSON.stringify(posts), {
            headers: {
                "Content-Type": "application/json"
            }
        });
    }
    catch(err){
        return new Response("Internal Server Error",{status:500});
    }
    
};
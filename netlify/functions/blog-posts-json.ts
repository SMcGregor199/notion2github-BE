import type {Context} from "@netlify/functions";
import { getStore } from "@netlify/blobs";
interface Manifest {
    current_key: string;
    lastUpdated: string;
}
export default async (req:Request,context:Context) => {
    try{    
        const content = getStore("content", { consistency: "strong" });
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

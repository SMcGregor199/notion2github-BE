import { getStore } from "@netlify/blobs";
import {config} from "dotenv";
config();
import fetchAndStoreLatestData from "../../utils/fetchAndStoreLatestData";



export default async(request, context) => {

    try{

        if (request.method === "OPTIONS") {
            return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin": "*","Access-Control-Allow-Methods": "GET, OPTIONS","Access-Control-Allow-Headers": request.headers.get("access-control-request-headers")}})
        }
        const store = getStore("content", { consistency: "strong" });
        const manifest = await store.get("content/manifest.json", {type:"json"});
        if (!manifest) return new Response("manifest not found",{status:404,headers:{"Access-Control-Allow-Origin": "*"}});
        
        const version = await fetchAndStoreLatestData();
        const ifNoneMatch = request.headers.get("if-none-match");
        if (ifNoneMatch && ifNoneMatch === version) {
            return new Response(null,{
                status: 304,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Expose-Headers": "ETag",
                    ETag: version,
                }
            });
        }
        const body = await store.get(version,{type:"json"});
        return new Response(JSON.stringify(body),{
            status: 200,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
                "Cache-Control": "max-age=30, stale-while-revalidate=300",
                "Access-Control-Expose-Headers": "ETag",
                ETag: version,
            },
        });

      

    }
    catch(err){
        console.error("Error fetching blog data:", err);
        return new Response(`Internal error: ${err.message || err}`,{
            status: 500,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "text/plain"
            },
        });
    }
}

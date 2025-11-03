import {config} from "dotenv";
config();
import {savePagesToFile} from "../../utils/helper";
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;




export default async (request, context) => {
    try{
        const blogData =  await savePagesToFile(NOTION_PAGE_ID)
        return Response.json(blogData, {
            headers: { 
                "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Vary": "Origin", 
            }
        });

    }
    catch(err){
        console.error("Error fetching blog data:", err);
        return Response.json({ ok: false, error: err.message }, {
            headers: { 
                "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Vary": "Origin", 
            }
        });
    }
}
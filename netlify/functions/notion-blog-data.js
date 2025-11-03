import {config} from "dotenv";
config();
import {savePagesToFile} from "../../utils/helper";
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;




export default async (request, context) => {
    try{
        const blogPostsData = await savePagesToFile(NOTION_PAGE_ID);
        
       return Response.json(blogPostsData, {
            headers: { "Cache-Control": "no-store" }
        });


    }
    catch(err){
        console.error("Error fetching blog data:", err);
        return Response.json({ ok: false, error: err.message }, {
            headers: { "Cache-Control": "no-store" }
        });
    }
}
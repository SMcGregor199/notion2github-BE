import type {Context} from "@netlify/functions";

export default async (req:Request,context:Context) => {
    if(req.method === "POST"){
        try{
            const body = await req.json();
            return new Response(JSON.stringify(body), {status:200, headers:{"Content-Type": "application/json"}});
        }
        catch(err){
            console.error("Error in sendResponse:", err);
            return new Response("Error", {status:500});
        }
    }
};
import { getStore } from "@netlify/blobs";
import { Client } from "@notionhq/client";
import {config} from "dotenv";
config();
const NOTION_API_KEY = process.env.NOTION_API_KEY;



//initilizing the Notion client
const notion = new Client({
    auth: NOTION_API_KEY,
})

export async function handler(event) {
    try{
        const blockId = event.queryStringParameters.blockId;
    }catch(err){
        console.log(err)
    }
 
}
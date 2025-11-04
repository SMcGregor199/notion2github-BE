import { getStore } from "@netlify/blobs";
import {config} from "dotenv";
import Crypto from "crypto";
config();
import {savePagesToFile} from "../../utils/helper";
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;



export default async (request, context) => {
    try{
        const blogData =  await savePagesToFile(NOTION_PAGE_ID)
        const stringifiedData = JSON.stringify(blogData);
        const hashKey = Crypto.createHash("sha256").update(stringifiedData).digest("hex");
        const blogDataStore = getStore({ name: "content", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_ACCESS_TOKEN });
        const isFound = await blogDataStore.get(hashKey); 
        if(isFound){
            return;
        } else {
            await blogDataStore.set(hashKey, stringifiedData);
            await blogDataStore.setJSON("content/manifest.json",{current_key:hashKey,lastUpdated:new Date().toISOString()});
        }

    }
    catch(err){
        console.error("Error fetching blog data:", err);
    }
}
import { getStore } from "@netlify/blobs";
import {config} from "dotenv";
config({ quiet: true });
import {savePagesToFile} from "./helper";
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
import Crypto from "crypto";
import { maybeSetupReactionAggregatesForBlogRefresh } from "../src/reactions/autoAggregateSetup.ts";

async function fetchAndStoreLatestData(){
    const store = getStore("content", { consistency: "strong" });
    const blogData =  await savePagesToFile(NOTION_PAGE_ID)
    await maybeSetupReactionAggregatesForBlogRefresh(blogData);
    const stringifiedData = JSON.stringify(blogData);
    const hashKey = Crypto.createHash("sha256").update(stringifiedData).digest("hex");
    await store.set(hashKey, stringifiedData);
    await store.setJSON("content/manifest.json",{current_key:hashKey,lastUpdated:new Date().toISOString()});
    return hashKey;
}
export default fetchAndStoreLatestData;

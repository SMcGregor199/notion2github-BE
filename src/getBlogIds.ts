import getEnvValue from "./utils/getEnvValue.js";
import type { BlockObjectResponse, PartialBlockObjectResponse, ListBlockChildrenResponse } from "@notionhq/client";
import {Client} from '@notionhq/client';
const notion = new Client({
    auth: getEnvValue("NOTION_API_KEY"),
})

async function getBlogPostIds(pageId:string):Promise<string[]>{
    try{
        const pageContentBlock : ListBlockChildrenResponse = await notion.blocks.children.list({block_id: pageId});
        const pageContentBlockResults : (BlockObjectResponse | PartialBlockObjectResponse)[] = pageContentBlock.results;
        const blogPostIds : string[] = pageContentBlockResults.map((page:BlockObjectResponse | PartialBlockObjectResponse):string=>page.id); 
        console.log(blogPostIds);
        return blogPostIds;

        
    }
    catch(err: unknown){
        console.error("Error Grabbing Blog Ids:", err);
        return [];
    }
}
 
export default getBlogPostIds;
import getEnvValue from "./utils/getEnvValue.js";
import type { BlockObjectResponse, PartialBlockObjectResponse, ListBlockChildrenResponse } from "@notionhq/client";
import {Client} from '@notionhq/client';
const notion = new Client({
    auth: getEnvValue("NOTION_API_KEY"),
})

async function getBlogPostTitles(pageId:string):Promise<string[]>{
    try{
        const pageContentBlock : ListBlockChildrenResponse = await notion.blocks.children.list({block_id: pageId});
        const pageContentBlockResults : (BlockObjectResponse | PartialBlockObjectResponse)[] = pageContentBlock.results;
        const blogPostTiles: string[] = [];
        for(let block of pageContentBlockResults){
            if("type" in block){
                if(block.type === "child_page"){
                    blogPostTiles.push(block.child_page.title);
                }
            }
        }
        //console.log(blogPostTiles);
        return blogPostTiles;
    }
    catch(err: unknown){
        console.error("Error Grabbing Blog Titles:", err);
        return [];
    }
}
//getBlogPostTitles(getEnvValue("NOTION_PAGE_ID"));
export default getBlogPostTitles;
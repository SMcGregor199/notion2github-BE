import {config} from 'dotenv';
config();
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
const NOTION_API_KEY = process.env.NOTION_API_KEY;

import {Client} from '@notionhq/client';
import {NotionToMarkdown} from 'notion-to-md';

//initilizing the Notion client
const notion = new Client({
    auth: NOTION_API_KEY,
})

//passing the notion client to the option
const n2m = new NotionToMarkdown({notionClient:notion});

async function getPageContentById(pageId){
    const mdblocks= await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);
    return (
        [mdblocks[1].children[0],mdblocks[1].children[1],mdblocks[1].children[2],mdblocks[1].children[3],
    mdblocks[1].children[4],mdblocks[1].children[5]]
    ); 
   // return mdString.parent;
}

getPageContentById(NOTION_PAGE_ID).then((content)=>console.log(content)).catch((error)=>console.log(error));
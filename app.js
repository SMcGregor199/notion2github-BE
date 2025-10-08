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
const n2m = new NotionToMarkdown({notionClient:notion, config:{parseChildPages:false}});



//15d0721d80858038b838ea42a1a2eeec

// ;(async ()=>{
//     const pageRes = await notion.pages.retrieve({page_id: NOTION_PAGE_ID});
//     console.log(pageRes.properties.title.title[0].plain_text);
//     const blockRes = await notion.blocks.children.list({block_id: NOTION_PAGE_ID});
//     console.log(blockRes.results[0].paragraph.rich_text[0].plain_text);
// })()

;(async ()=>{
    const mdblocks= await n2m.pageToMarkdown(NOTION_PAGE_ID); //returns an array with all the page's blocks
    const mdString = n2m.toMarkdownString(mdblocks); // this returns an object that points to the markdown
    console.log(mdblocks);
    console.log(mdString.parent); // this is the markdown itself.
})()

function mdMetadata(page_id){

}
import {config} from 'dotenv';
config();
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
const NOTION_API_KEY = process.env.NOTION_API_KEY;

import {Client} from '@notionhq/client';


const notion = new Client({
    auth: NOTION_API_KEY,
})

//15d0721d80858038b838ea42a1a2eeec

;(async ()=>{
    const pageRes = await notion.pages.retrieve({page_id: NOTION_PAGE_ID});
    console.log(pageRes.properties.title.title[0].plain_text);
    const blockRes = await notion.blocks.children.list({block_id: NOTION_PAGE_ID});
    console.log(blockRes.results[0].paragraph.rich_text[0].plain_text);
})()


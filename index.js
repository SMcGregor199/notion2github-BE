import {config} from 'dotenv';
config();
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
const NOTION_API_KEY = process.env.NOTION_API_KEY;

import {Client} from '@notionhq/client';


const notion = new Client({
    auth: NOTION_API_KEY,
})

;(async ()=>{
const response = await notion.blocks.children.list({block_id: NOTION_PAGE_ID});
console.log(response.results[0].paragraph.rich_text[0].plain_text);
})()


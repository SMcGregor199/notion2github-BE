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


const n2m = new NotionToMarkdown({notionClient:notion});

//15d0721d80858038b838ea42a1a2eeec

;(async ()=>{
    // const pageRes = await notion.pages.retrieve({page_id: NOTION_PAGE_ID});
    // console.log(pageRes.properties.title.title[0].plain_text);
    const {results} = await notion.blocks.children.list({block_id: NOTION_PAGE_ID});
    const x = await n2m.blocksToMarkdown(results);
    console.log(results)
    console.log(x);
})()


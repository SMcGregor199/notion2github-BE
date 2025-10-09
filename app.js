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







// ;(async ()=>{
//     const mdblocks= await n2m.pageToMarkdown(NOTION_PAGE_ID); //returns an array with all the page's blocks
//     const mdString = n2m.toMarkdownString(mdblocks); // this returns an object that points to the markdown
//     console.log(mdString.parent); // this is the markdown itself.
// })()

async function getPageMetadataById(pageId){
    const pageRes = await notion.pages.retrieve({page_id: pageId});
    var title = pageRes.properties.title.title[0].plain_text;
    const currentYear = new Date().getFullYear();
    const currentDay = new Date().toLocaleString('en-US',{day:'2-digit'});
    const currentMonth = new Date().toLocaleString('en-US',{month:'2-digit'});
    const currentDate = `${currentMonth}/${currentDay}/${currentYear}`;
    console.log(currentDate);
    console.log(title);
    
return `
---
title: "${title}"
author: Shayne McGregor
last updated: ${currentDate}
--- 

# **${title}** `;
}


getPageMetadataById(NOTION_PAGE_ID).then((metaData)=>{console.log(metaData)});
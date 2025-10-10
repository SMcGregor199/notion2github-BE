import {config} from 'dotenv';
import { writeFile } from 'fs/promises';
import slugify from 'slugify';
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

async function getPageContentById(pageId){
    const mdblocks= await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);

    return mdString.parent;
}

async function getPageMetadataById(pageId){
    const pageRes = await notion.pages.retrieve({page_id: pageId});
    const title = pageRes.properties.title.title[0].plain_text;
    const currentYear = new Date().getFullYear();
    const currentDay = new Date().toLocaleString('en-US',{day:'2-digit'});
    const currentMonth = new Date().toLocaleString('en-US',{month:'2-digit'});
    const currentDate = `${currentMonth}/${currentDay}/${currentYear}`;
    
return [`
---
title: "${title}"
author: "Shayne McGregor"
last updated: "${currentDate}"
description: "Quick test of the Notion-to-GitHub sync workflow"
tags: ["Notion","Markdown","GitHub"]
--- 

# ${title} `,title] ;
}

function conCatMetadataAndContent(metadata, content) {
  return metadata[0].concat("\n\n", content);
}


async function createMdFile(pageId){
    const metadata = await getPageMetadataById(pageId);
    const fileName = slugify(metadata[1],{lower:true})
    const content = await getPageContentById(pageId);
    const studyDoc = conCatMetadataAndContent(metadata, content);
    await writeFile(`./study-notes/${fileName}.md`, studyDoc);

}

createMdFile(NOTION_PAGE_ID)
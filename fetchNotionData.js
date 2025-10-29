import {config} from 'dotenv';
config();
import fs from "fs/promises";
import {Client} from '@notionhq/client';
import slugify from 'slugify';
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
const NOTION_API_KEY = process.env.NOTION_API_KEY;



//initilizing the Notion client
const notion = new Client({
    auth: NOTION_API_KEY,
})



async function getChildPages(pageId){
    try{
        const response = await notion.blocks.children.list({block_id: pageId});
        
        
        const pagesArray = await Promise.all( 
            
            response.results.filter((page)=>page.type ==='child_page').map(async(page)=>{
                let thePageId = page.id;
                //console.log(page);
                let pageContent = await getPageContentById(thePageId);
                let tag = pageContent.results[pageContent.results.length-1].to_do.rich_text[1].text.content;
                let title = await getPageTitleById(thePageId);
                let summary = pageContent.results[0].heading_3.rich_text[0].plain_text;
                let link = slugify(title,{lower:true});
                let thumbnail = `${process.env.BACKEND_ORIGIN}/.netlify/functions/notion-image?blockId=${thePageId}`;
                let body = await getPageBodyContent(thePageId);
                let [publishedDate, updatedDate]= await getPageMetadataById(thePageId);
                return {
                    id:thePageId,
                    tag,
                    title,
                    summary,
                    link,
                    thumbnail,
                    body,
                    publishedDate,
                    updatedDate
                }
                
            })
        );
       
        return pagesArray;

    } catch(err){
        console.error("Error fetching child pages:", err);
    }
    

}
async function savePagesToFile(id){
    try{
        const parentPageId = id;
        const childPagesContent = await getChildPages(parentPageId);
        const jsContent = `export const blogPostsData = ${JSON.stringify(childPagesContent,null,2)};\n`;
        await fs.writeFile("./data/notionBlogData.js", jsContent);
        console.log("✅ notionBlogData.js successfully written!");
    } catch(err){
        console.error("Error writing file:", err);
    }
}

async function getPageContentById(pageId){
    try{
        const childPage = await notion.blocks.children.list({block_id: pageId});
        return childPage;
    }
    catch(err){
        console.error("Error fetching page content:", err);
    }

}
async function getPageTitleById(pageId){
    try{
        const page = await notion.pages.retrieve({page_id: pageId});
        return page.properties.title.title[0].plain_text;
    }
    catch(err){
        console.log("Error fetching page title:", err);
    }
}


async function getPageBodyContent(pageId){
    let pageContent = await getPageContentById(pageId);
    const bodyContent = pageContent.results.slice(1, -1);
    const grouped = bodyContent.reduce((acc,curr)=>{
        if(curr.type === "heading_3"){
            acc.push({heading:curr.heading_3.rich_text[0].plain_text,paras:[]});
        } else if(curr.type === "paragraph"){
            acc[acc.length-1].paras.push(curr.paragraph.rich_text[0].plain_text);
        }
        return acc;
    },[]);
    return grouped;
}

async function getPageMetadataById(pageId){
    const page = await notion.pages.retrieve({page_id: pageId});
    return [page.created_time, page.last_edited_time ];

}
savePagesToFile(NOTION_PAGE_ID);


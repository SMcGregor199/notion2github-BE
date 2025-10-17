import {config} from 'dotenv';
config();
import fs from "fs/promises";
import {Client} from '@notionhq/client';
//import {NotionToMarkdown} from 'notion-to-md';
const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
const NOTION_API_KEY = process.env.NOTION_API_KEY;



//initilizing the Notion client
const notion = new Client({
    auth: NOTION_API_KEY,
})

//passing the notion client to the option
//const n2m = new NotionToMarkdown({notionClient:notion});

async function getChildPages(pageId){
    try{
        const response = await notion.blocks.children.list({block_id: pageId});
        
        
        const pagesArray = response.results.filter((page)=>page.type ==='child_page').map((page)=>{
            return {
                id:page.id,
                tag:"",
                title:page.child_page.title,
                summary:"",
                link:"#",
                thumbnail:""
            };
        });

        return pagesArray;

    } catch(err){
        console.error("Error fetching child pages:", err);
    }
    

}
async function savePagesToFile(){
    try{
        const parentPageId = NOTION_PAGE_ID;
        const childPages = await getChildPages(parentPageId);
        const jsContent = `export default ${JSON.stringify(childPages,null,2)};\n`;
        await fs.writeFile("./data/notionBlogData.js", jsContent);
        console.log("✅ pages.js successfully written!");
    } catch{
        console.error("Error writing file:", err);
    }
}
//savePagesToFile();
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

//getPageContentById("28e0721d-8085-80fc-80f6-f4f80b9920f5").then((content)=>console.log(content.results[5].paragraph.rich_text)).catch((error)=>console.log(error));
getPageContentById("28e0721d-8085-80fc-80f6-f4f80b9920f5").then((content)=>console.log(content.results)).catch((error)=>console.log(error));
getPageTitleById("28e0721d-8085-80fc-80f6-f4f80b9920f5").then((title)=>console.log(title)).catch((error)=>console.log(error));
// getPageContentById(NOTION_PAGE_ID).then((content)=>console.log(content.results)).catch((error)=>console.log(error));
// getChildPages(NOTION_PAGE_ID).then((content)=>console.log(content)).catch((error)=>console.log(error));
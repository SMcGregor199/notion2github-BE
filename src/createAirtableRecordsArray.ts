import type {AirtableRecord} from "./utils/types/index.js";
import getBlogPostIds from "./getBlogPostIds.js";
import getBlogPostTitles from "./getBlogPostTitles.js";
import getEnvValue from "./utils/getEnvValue.js";
function createAirtableRecordsArray(blogPostIds:string[], blogPostTitles:string[]): AirtableRecord[] {
    const airtableRecords: AirtableRecord[] = [];

    for(let id of blogPostIds){
        const record: AirtableRecord = {
            "fields":{
                "Id": id,
                "Blog Title": blogPostTitles[blogPostIds.indexOf(id)],
                "Loved": 0,
                "Confused": 0,
                "Thought Provoking": 0
            }
        }   
        airtableRecords.push(record);
    }
    return airtableRecords;
}
const ids = await getBlogPostIds(getEnvValue("NOTION_PAGE_ID"));
const titles = await getBlogPostTitles(getEnvValue("NOTION_PAGE_ID"))
createAirtableRecordsArray(ids, titles);
export default createAirtableRecordsArray;
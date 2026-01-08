import Airtable from "airtable";
import getEnvValue from "./utils/getEnvValue.js";
import type {AirtableRecord} from "./utils/types/index.js";
import {config} from "dotenv";
config();



async function seedAirtableWithBlogPostReactData(array: AirtableRecord[]):Promise<void>{
    const base = new Airtable({apiKey: getEnvValue("AIRTABLE_API_KEY")}).base(getEnvValue("AIRTABLE_BASE_ID"));
    try{
        const records = await base("Blog Posts").create(array);
        console.log("Successfully seeded airtable");
    }
    catch(err: unknown){
        console.error("Error seeding airtable:", err);
        throw err;
        
    }
    
}

export default seedAirtableWithBlogPostReactData;
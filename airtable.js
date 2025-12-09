import Airtable from "airtable";
import {config} from "dotenv";
config();

const base = new Airtable({apiKey: process.env.AIRTABLE_API_KEY}).base(process.env.AIRTABLE_BASE_ID);
base("Table 1").create([
    {
     "fields":{
        "Name":"Shayne McGregor",
        "Loved":10,
        "Confused":10,
        "Thought Provoking":50
     }   
    }
],function(err,records){
    if(err){
        console.error(err);
        return;
    }
    records.forEach((record)=>{
        console.log(record.getId());
    });
});

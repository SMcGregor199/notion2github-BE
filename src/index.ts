import getEnvValue from "./utils/getEnvValue.js";
import getBlogPostIds from "./getBlogPostIds.js";
import getBlogPostTitles from "./getBlogPostTitles.js";
import createAirtableRecordsArray from "./createAirtableRecordsArray.js";
import seedAirtableWithBlogPostReactData from "./seedAirtableWithBlogPostReacData.js";

const NOTION_PAGE_ID = getEnvValue("NOTION_PAGE_ID");

const ids = await getBlogPostIds(NOTION_PAGE_ID);
const titles = await getBlogPostTitles(NOTION_PAGE_ID);
const array = createAirtableRecordsArray(ids, titles);
await seedAirtableWithBlogPostReactData(array);
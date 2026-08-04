import { getStore } from "@netlify/blobs";
import { Client } from "@notionhq/client";
import { createResourceGuideHandler } from "../../src/resources/resourceGuideHttp.js";
import type { ResourceGuideNotionClient, ResourceGuideStore } from "../../src/resources/types.js";

const handler = createResourceGuideHandler({
  store: getStore("resources", { consistency: "strong" }) as unknown as ResourceGuideStore,
  notion: new Client({ auth: process.env.NOTION_API_KEY }) as unknown as ResourceGuideNotionClient,
});

export default handler;

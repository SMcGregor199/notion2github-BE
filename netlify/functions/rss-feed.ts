import { getStore } from "@netlify/blobs";
import {
  RSS_OUTPUT_KEY_ENV,
  RSS_OUTPUT_STORE_ENV,
  type RSSUpdateStore,
} from "../../src/rss/autoRSSUpdate.ts";
import { serveRSSFromStore } from "../../src/rss/rssResponse.ts";

export default async () => {
  const outputStore = process.env[RSS_OUTPUT_STORE_ENV]?.trim() || "content";
  const outputKey = process.env[RSS_OUTPUT_KEY_ENV]?.trim() || "rss.xml";

  return serveRSSFromStore({
    store: getStore(outputStore) as RSSUpdateStore,
    outputKey,
  });
};

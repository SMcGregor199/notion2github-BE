import { getStore } from "@netlify/blobs";
import { servePostsSitemap } from "../../src/sitemap/sitemapResponse.ts";

export default async () => servePostsSitemap({
  store: getStore("content", { consistency: "strong" }),
});

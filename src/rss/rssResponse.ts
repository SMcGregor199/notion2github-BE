import { RSS_OUTPUT_KEY_ENV, type RSSUpdateStore } from "./autoRSSUpdate.js";

export const RSS_RESPONSE_CONTENT_TYPE = "application/rss+xml; charset=utf-8";
export const RSS_RESPONSE_CACHE_CONTROL = "max-age=60, stale-while-revalidate=300";

type RSSReadStore = Pick<RSSUpdateStore, "get">;

type RSSResponseOptions = {
  store: RSSReadStore;
  outputKey?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Console, "error">;
};

export async function serveRSSFromStore(options: RSSResponseOptions): Promise<Response> {
  const logger = options.logger ?? console;
  const env = options.env ?? process.env;
  const outputKey = options.outputKey?.trim() || env[RSS_OUTPUT_KEY_ENV]?.trim() || "rss.xml";

  try {
    const rssXML = await options.store.get(outputKey, { type: "text" });
    if (typeof rssXML !== "string" || !rssXML.trim()) {
      return textResponse("RSS feed not found", 404);
    }

    return new Response(rssXML, {
      status: 200,
      headers: {
        "Content-Type": RSS_RESPONSE_CONTENT_TYPE,
        "Cache-Control": RSS_RESPONSE_CACHE_CONTROL,
      },
    });
  } catch (error) {
    logger.error("RSS feed response failed", {
      outputKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return textResponse("Internal Server Error", 500);
  }
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

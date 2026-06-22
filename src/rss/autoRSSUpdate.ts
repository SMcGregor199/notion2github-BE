import { getStore } from "@netlify/blobs";
import { generateRSSFeedXML, type RSSBlogPostInput, validateRSSXML } from "./rssFeed.js";

export const RSS_AUTO_UPDATE_ENV = "RSS_AUTO_UPDATE_ON_BLOG_REFRESH";
export const RSS_PUBLIC_URL_ENV = "RSS_PUBLIC_URL";
export const RSS_SITE_BASE_URL_ENV = "RSS_SITE_BASE_URL";
export const RSS_OUTPUT_STORE_ENV = "RSS_OUTPUT_STORE";
export const RSS_OUTPUT_KEY_ENV = "RSS_OUTPUT_KEY";
export const RSS_PREVIOUS_CONTENT_HASH_KEY_ENV = "RSS_PREVIOUS_CONTENT_HASH_KEY";

export type RSSUpdateStore = {
  get(key: string, options?: { type?: "json" | "text" }): Promise<unknown>;
  set(key: string, value: string, options?: Record<string, unknown>): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
};

export type RSSUpdateResult =
  | {
      enabled: false;
      status: "disabled";
    }
  | {
      enabled: true;
      status: "skipped";
      reason: "unchanged";
      contentHash: string;
    }
  | {
      enabled: true;
      status: "published";
      contentHash: string;
      outputStore: string;
      outputKey: string;
      itemCount: number;
    }
  | {
      enabled: true;
      status: "failed";
      contentHash: string;
      error: string;
    };

export type RSSUpdateOptions = {
  enabled?: boolean;
  contentHash: string;
  previousContentHash?: string;
  store?: RSSUpdateStore;
  logger?: Pick<Console, "info" | "error">;
  env?: NodeJS.ProcessEnv;
  buildTime?: Date;
};

type RSSMarker = {
  current_key?: string;
  lastUpdated?: string;
};

export async function maybeUpdateRSSForBlogRefresh(
  publicPosts: RSSBlogPostInput[] | undefined,
  options: RSSUpdateOptions,
): Promise<RSSUpdateResult> {
  const logger = options.logger ?? console;
  const env = options.env ?? process.env;
  const enabled = options.enabled ?? isRSSAutoUpdateEnabled(env);

  if (!enabled) {
    logger.info("RSS auto-update skipped", {
      reason: "disabled",
      env: RSS_AUTO_UPDATE_ENV,
    });
    return { enabled: false, status: "disabled" };
  }

  const contentHash = options.contentHash.trim();
  if (!contentHash) {
    const result = failedResult("", "contentHash is required");
    logger.error("RSS auto-update failed", result);
    return result;
  }

  const outputStore = env[RSS_OUTPUT_STORE_ENV]?.trim() || "content";
  const outputKey = env[RSS_OUTPUT_KEY_ENV]?.trim() || "rss.xml";
  const markerKey = env[RSS_PREVIOUS_CONTENT_HASH_KEY_ENV]?.trim() || "content/rss-manifest.json";
  const store: RSSUpdateStore = options.store ?? getStore(outputStore);

  try {
    const marker = await getRSSMarker(store, markerKey);
    const previousPublishedHash = marker?.current_key ?? options.previousContentHash;
    if (previousPublishedHash === contentHash) {
      logger.info("RSS auto-update skipped", {
        reason: "unchanged",
        contentHash,
        outputStore,
        outputKey,
      });
      return { enabled: true, status: "skipped", reason: "unchanged", contentHash };
    }

    const posts = Array.isArray(publicPosts) ? publicPosts : [];
    const rssXML = generateRSSFeedXML(posts, {
      siteBaseUrl: env[RSS_SITE_BASE_URL_ENV],
      feedUrl: env[RSS_PUBLIC_URL_ENV],
      buildTime: options.buildTime,
    });
    validateRSSXML(rssXML);

    await store.set(outputKey, rssXML, { contentType: "application/rss+xml; charset=utf-8" });
    await store.setJSON(markerKey, {
      current_key: contentHash,
      lastUpdated: new Date().toISOString(),
      output_key: outputKey,
      item_count: posts.length,
    });

    logger.info("RSS auto-update published", {
      contentHash,
      outputStore,
      outputKey,
      itemCount: posts.length,
    });
    return { enabled: true, status: "published", contentHash, outputStore, outputKey, itemCount: posts.length };
  } catch (error) {
    const result = failedResult(contentHash, error instanceof Error ? error.message : String(error));
    logger.error("RSS auto-update failed; preserving last known good feed", result);
    return result;
  }
}

export function isRSSAutoUpdateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RSS_AUTO_UPDATE_ENV] === "true";
}

async function getRSSMarker(store: RSSUpdateStore, markerKey: string): Promise<RSSMarker | undefined> {
  const marker = await store.get(markerKey, { type: "json" });
  if (!marker || typeof marker !== "object") return undefined;
  return marker as RSSMarker;
}

function failedResult(contentHash: string, error: string): RSSUpdateResult {
  return {
    enabled: true,
    status: "failed",
    contentHash,
    error,
  };
}

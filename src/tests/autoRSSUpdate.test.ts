import { describe, expect, it } from "vitest";
import {
  maybeUpdateRSSForBlogRefresh,
  RSS_AUTO_UPDATE_ENV,
  RSS_OUTPUT_KEY_ENV,
  RSS_OUTPUT_STORE_ENV,
  RSS_PREVIOUS_CONTENT_HASH_KEY_ENV,
  RSS_PUBLIC_URL_ENV,
  RSS_SITE_BASE_URL_ENV,
  type RSSUpdateStore,
} from "../rss/autoRSSUpdate.js";
import { generateRSSFeedXML } from "../rss/rssFeed.js";

class MemoryRSSStore implements RSSUpdateStore {
  values = new Map<string, unknown>();
  setCalls: Array<{ key: string; value: string; options?: Record<string, unknown> }> = [];

  async get(key: string): Promise<unknown> {
    return this.values.get(key);
  }

  async set(key: string, value: string, options?: Record<string, unknown>): Promise<void> {
    this.setCalls.push({ key, value, options });
    this.values.set(key, value);
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }
}

const logger = {
  info: () => undefined,
  error: () => undefined,
};

describe("automatic RSS update", () => {
  it("is disabled by default so refreshes do not write RSS", async () => {
    const store = new MemoryRSSStore();

    const result = await maybeUpdateRSSForBlogRefresh([post("post_1")], {
      contentHash: "hash_1",
      store,
      logger,
      env: {},
    });

    expect(result).toEqual({ enabled: false, status: "disabled" });
    expect(store.setCalls).toEqual([]);
  });

  it("skips safely when the RSS marker already has the current hash", async () => {
    const store = new MemoryRSSStore();
    store.values.set("content/rss-manifest.json", { current_key: "hash_1" });

    const result = await maybeUpdateRSSForBlogRefresh([post("post_1")], {
      enabled: true,
      contentHash: "hash_1",
      store,
      logger,
      env: {},
    });

    expect(result).toEqual({
      enabled: true,
      status: "skipped",
      reason: "unchanged",
      contentHash: "hash_1",
    });
    expect(store.setCalls).toEqual([]);
  });

  it("generates and stores validated RSS when explicitly enabled and changed", async () => {
    const store = new MemoryRSSStore();

    const result = await maybeUpdateRSSForBlogRefresh([post("post_1")], {
      enabled: true,
      contentHash: "hash_2",
      previousContentHash: "hash_1",
      store,
      logger,
      buildTime: new Date("2026-02-15T12:00:00.000Z"),
      env: {
        [RSS_OUTPUT_STORE_ENV]: "content",
        [RSS_OUTPUT_KEY_ENV]: "rss.xml",
        [RSS_PREVIOUS_CONTENT_HASH_KEY_ENV]: "content/rss-manifest.json",
        [RSS_SITE_BASE_URL_ENV]: "https://shaynemcgregor.dev",
        [RSS_PUBLIC_URL_ENV]: "https://shaynemcgregor.dev/rss.xml",
      },
    });

    expect(result).toMatchObject({
      enabled: true,
      status: "published",
      contentHash: "hash_2",
      outputStore: "content",
      outputKey: "rss.xml",
      itemCount: 1,
    });
    expect(store.setCalls).toHaveLength(1);
    expect(store.setCalls[0]?.value).toContain("<rss ");
    expect(store.setCalls[0]?.value).toContain("https://shaynemcgregor.dev/blog/post-one");
    expect(store.values.get("content/rss-manifest.json")).toMatchObject({
      current_key: "hash_2",
      output_key: "rss.xml",
      item_count: 1,
    });
  });

  it("preserves the last known good feed when generation fails", async () => {
    const store = new MemoryRSSStore();
    store.values.set("rss.xml", "last known good");

    const result = await maybeUpdateRSSForBlogRefresh([{ id: "post_1", title: "Bad", link: "bad" }], {
      enabled: true,
      contentHash: "hash_bad",
      previousContentHash: "hash_old",
      store,
      logger,
      env: {},
    });

    expect(result).toMatchObject({
      enabled: true,
      status: "failed",
      contentHash: "hash_bad",
    });
    expect(store.values.get("rss.xml")).toBe("last known good");
  });

  it("uses the explicit non-secret environment names", () => {
    expect(RSS_AUTO_UPDATE_ENV).toBe("RSS_AUTO_UPDATE_ON_BLOG_REFRESH");
    expect(RSS_PUBLIC_URL_ENV).toBe("RSS_PUBLIC_URL");
    expect(RSS_SITE_BASE_URL_ENV).toBe("RSS_SITE_BASE_URL");
    expect(RSS_OUTPUT_STORE_ENV).toBe("RSS_OUTPUT_STORE");
    expect(RSS_OUTPUT_KEY_ENV).toBe("RSS_OUTPUT_KEY");
    expect(RSS_PREVIOUS_CONTENT_HASH_KEY_ENV).toBe("RSS_PREVIOUS_CONTENT_HASH_KEY");
  });
});

describe("backend RSS feed generation", () => {
  it("escapes XML, orders newest first, and uses stable GUIDs and /blog links", () => {
    const xml = generateRSSFeedXML(
      [
        post("post_old", "Old <Post>", "old-post", "2026-01-01T12:00:00.000Z"),
        post("post_new", "New & Post", "new-post", "2026-02-01T12:00:00.000Z"),
      ],
      { buildTime: new Date("2026-02-15T12:00:00.000Z") },
    );

    expect(xml).toContain("<title>New &amp; Post</title>");
    expect(xml).toContain("<title>Old &lt;Post&gt;</title>");
    expect(xml.indexOf("post_new")).toBeLessThan(xml.indexOf("post_old"));
    expect(xml).toContain("<link>https://shaynemcgregor.dev/blog/new-post</link>");
    expect(xml).toContain('<guid isPermaLink="false">post_new</guid>');
    expect(xml).toContain('<atom:link href="https://shaynemcgregor.dev/rss.xml" rel="self" type="application/rss+xml" />');
  });

  it("uses body fallback when summary is missing and omits invalid thumbnails", () => {
    const xml = generateRSSFeedXML(
      [
        {
          ...post("post_body"),
          summary: "",
          thumbnail: "/relative.png",
          body: [{ heading: "Intro", paras: ["", "Body fallback."] }],
        },
      ],
      { buildTime: new Date("2026-02-15T12:00:00.000Z") },
    );

    expect(xml).toContain("<description>Body fallback.</description>");
    expect(xml).not.toContain("<enclosure");
  });

  it("rejects malformed posts instead of creating partial RSS", () => {
    expect(() =>
      generateRSSFeedXML([{ id: "post_bad", title: "Bad", link: "bad", publishedDate: "not-a-date" }]),
    ).toThrow(/invalid publishedDate/);
  });
});

function post(
  id: string,
  title = "Post One",
  link = "post-one",
  publishedDate = "2026-01-10T13:58:00.000Z",
) {
  return {
    id,
    title,
    summary: `Summary for ${title}`,
    link,
    thumbnail: "https://shaynemcgregordev-be.netlify.app/.netlify/functions/notion-image?blockId=abc",
    publishedDate,
    updatedDate: publishedDate,
    body: [],
  };
}

import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_MANIFEST_KEY,
  SITEMAP_CACHE_CONTROL,
  SITEMAP_CONTENT_TYPE,
  servePostsSitemap,
} from "../sitemap/sitemapResponse.js";

class ReadMemoryStore {
  values = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.values.get(key);
  }
}

describe("posts sitemap response", () => {
  it("serves canonical published-post URLs with escaped XML and updated dates", async () => {
    const store = contentStore([
      { link: "a-valid-post", updatedDate: "2026-07-20T13:45:00.000Z", publishedDate: "2026-07-19T12:00:00.000Z" },
      { link: "second-post", publishedDate: "2026-07-18T12:00:00.000Z" },
    ]);

    const response = await servePostsSitemap({ store });
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(SITEMAP_CONTENT_TYPE);
    expect(response.headers.get("Cache-Control")).toBe(SITEMAP_CACHE_CONTROL);
    expect(xml).toContain("https://shaynemcgregor.dev/blog/a-valid-post");
    expect(xml).toContain("<lastmod>2026-07-20T13:45:00.000Z</lastmod>");
    expect(xml).toContain("<lastmod>2026-07-18T12:00:00.000Z</lastmod>");
  });

  it("escapes XML values when a configured canonical URL contains XML characters", async () => {
    const store = contentStore([{ link: "safe-post", publishedDate: "2026-07-18" }]);

    const response = await servePostsSitemap({ store, siteUrl: "https://example.com/?source=a&b" });

    expect(await response.text()).toContain("https://example.com/?source=a&amp;b/blog/safe-post");
  });

  it("omits malformed posts and invalid dates without failing the current sitemap", async () => {
    const store = contentStore([
      { link: "valid-post", updatedDate: "not-a-date", publishedDate: "2026-02-31" },
      { link: "bad/slash", publishedDate: "2026-07-18" },
      { link: "", publishedDate: "2026-07-18" },
      null,
    ]);

    const response = await servePostsSitemap({ store });
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("https://shaynemcgregor.dev/blog/valid-post");
    expect(xml).not.toContain("<lastmod>");
    expect(xml).not.toContain("bad/slash");
  });

  it("returns 503 when the current content manifest or blob is unavailable", async () => {
    const noManifest = new ReadMemoryStore();
    const noManifestResponse = await servePostsSitemap({ store: noManifest });

    const missingContent = new ReadMemoryStore();
    missingContent.values.set(CONTENT_MANIFEST_KEY, { current_key: "missing" });
    const missingContentResponse = await servePostsSitemap({ store: missingContent });

    expect(noManifestResponse.status).toBe(503);
    expect(missingContentResponse.status).toBe(503);
    expect(noManifestResponse.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });

  it("returns 503 and logs when reading current content fails", async () => {
    const logger = { error: vi.fn() };
    const store = {
      async get(): Promise<unknown> {
        throw new Error("store unavailable");
      },
    };

    const response = await servePostsSitemap({ store, logger });

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      "Posts sitemap response failed",
      expect.objectContaining({ error: "store unavailable" }),
    );
  });
});

function contentStore(posts: unknown[]): ReadMemoryStore {
  const store = new ReadMemoryStore();
  store.values.set(CONTENT_MANIFEST_KEY, { current_key: "current-posts" });
  store.values.set("current-posts", posts);
  return store;
}

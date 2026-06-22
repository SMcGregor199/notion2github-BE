import { describe, expect, it, vi } from "vitest";
import {
  RSS_RESPONSE_CACHE_CONTROL,
  RSS_RESPONSE_CONTENT_TYPE,
  serveRSSFromStore,
} from "../rss/rssResponse.js";

class ReadMemoryStore {
  values = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.values.get(key);
  }
}

describe("RSS feed response", () => {
  it("serves the configured RSS blob with RSS content headers", async () => {
    const store = new ReadMemoryStore();
    store.values.set("rss.xml", '<?xml version="1.0"?><rss version="2.0"></rss>');

    const response = await serveRSSFromStore({ store });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(RSS_RESPONSE_CONTENT_TYPE);
    expect(response.headers.get("Cache-Control")).toBe(RSS_RESPONSE_CACHE_CONTROL);
    expect(await response.text()).toContain("<rss");
  });

  it("uses the output key environment name without requiring secret values", async () => {
    const store = new ReadMemoryStore();
    store.values.set("feeds/current.xml", "<rss></rss>");

    const response = await serveRSSFromStore({
      store,
      env: { RSS_OUTPUT_KEY: "feeds/current.xml" },
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<rss></rss>");
  });

  it("returns 404 when no RSS blob has been published yet", async () => {
    const store = new ReadMemoryStore();

    const response = await serveRSSFromStore({ store });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("RSS feed not found");
  });

  it("logs and returns 500 when Blob reads fail", async () => {
    const logger = { error: vi.fn() };
    const store = {
      async get(): Promise<unknown> {
        throw new Error("store unavailable");
      },
    };

    const response = await serveRSSFromStore({ store, logger });

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal Server Error");
    expect(logger.error).toHaveBeenCalledWith(
      "RSS feed response failed",
      expect.objectContaining({ outputKey: "rss.xml", error: "store unavailable" }),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { createResourceGuideHandler } from "../resources/resourceGuideHttp.js";
import {
  RESOURCE_GUIDE_MANIFEST_KEY,
  loadResourceGuide,
  normalizeResourcePage,
} from "../resources/resourceGuideService.js";

class MemoryStore {
  values = new Map<string, unknown>();

  async get(key: string): Promise<unknown> { return this.values.get(key); }
  async set(key: string, value: string): Promise<void> { this.values.set(key, JSON.parse(value)); }
  async setJSON(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

function resourcePage(overrides: Record<string, unknown> = {}) {
  return {
    id: "resource-1",
    created_time: "2026-08-01T12:00:00.000Z",
    properties: {
      Name: { type: "title", title: [{ plain_text: "AI evidence review" }] },
      URL: { type: "url", url: "https://example.org/review" },
      "Publication Status": { type: "select", select: { name: "Published" } },
      "Resource Category": { type: "select", select: { name: "Studies & Evidence" } },
      Tags: { type: "multi_select", multi_select: [{ name: "Methods" }] },
      "Private Research Notes": { type: "rich_text", rich_text: [{ plain_text: "Never public" }] },
      ...overrides,
    },
  };
}

function notionWithPages(pages: unknown[]) {
  return {
    databases: { retrieve: vi.fn(async () => ({ data_sources: [{ id: "resources-source" }] })) },
    dataSources: { query: vi.fn(async () => ({ results: pages, has_more: false, next_cursor: null })) },
  };
}

describe("Resource Guide pipeline", () => {
  it("normalizes only public fields and keeps private notes out of the contract", () => {
    const normalized = normalizeResourcePage(resourcePage({
      "Public Annotation": { type: "rich_text", rich_text: [{ plain_text: "Useful for methods." }] },
      "Research-process Stage": { type: "multi_select", multi_select: [{ name: "Literature review" }] },
    }));

    expect(normalized?.resource).toMatchObject({
      title: "AI evidence review",
      category: "Studies & Evidence",
      publicAnnotation: "Useful for methods.",
      researchStages: ["Literature review"],
    });
    expect(JSON.stringify(normalized?.resource)).not.toContain("Never public");
  });

  it("skips unpublished or malformed resources", () => {
    expect(normalizeResourcePage(resourcePage({
      "Publication Status": { type: "select", select: { name: "Draft" } },
    }))).toBeNull();
    expect(normalizeResourcePage(resourcePage({ URL: { type: "url", url: "javascript:alert(1)" } }))).toBeNull();
  });

  it("queries Notion once, stores normalized data, and serves a fresh snapshot without another query", async () => {
    const store = new MemoryStore();
    const notion = notionWithPages([resourcePage()]);
    const now = new Date("2026-08-04T12:00:00.000Z");

    const first = await loadResourceGuide({ store, notion, databaseId: "database-1", now });
    const second = await loadResourceGuide({ store, notion, databaseId: "database-1", now: new Date("2026-08-04T12:30:00.000Z") });

    expect(first.response.resources).toHaveLength(1);
    expect(second.stale).toBe(false);
    expect(notion.dataSources.query).toHaveBeenCalledTimes(1);
    expect(store.values.get(RESOURCE_GUIDE_MANIFEST_KEY)).toEqual(expect.objectContaining({ fetchedAt: now.toISOString() }));
  });

  it("serves a stale snapshot when refresh fails", async () => {
    const store = new MemoryStore();
    store.values.set(RESOURCE_GUIDE_MANIFEST_KEY, { currentKey: "guide/content/old.json", fetchedAt: "2026-08-04T10:00:00.000Z" });
    store.values.set("guide/content/old.json", { resources: [normalizeResourcePage(resourcePage())?.resource], generatedAt: "2026-08-04T10:00:00.000Z" });
    const notion = notionWithPages([]);
    notion.dataSources.query.mockRejectedValueOnce(new Error("Notion unavailable"));

    const result = await loadResourceGuide({
      store,
      notion,
      databaseId: "database-1",
      now: new Date("2026-08-04T12:00:00.000Z"),
    });

    expect(result.stale).toBe(true);
    expect(result.response.resources[0]?.title).toBe("AI evidence review");
  });

  it("returns a controlled 503 when the data source is not configured", async () => {
    const handler = createResourceGuideHandler({
      store: new MemoryStore(),
      notion: notionWithPages([]),
      env: {},
      logger: { error: vi.fn() },
    });

    const response = await handler(new Request("https://example.test/.netlify/functions/resource-guide-data"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "resource_guide_unavailable", message: "Resource Guide data is temporarily unavailable." },
    });
  });
});

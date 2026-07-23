import { afterEach, describe, expect, it, vi } from "vitest";

const mockRefreshPublishedBlogData = vi.hoisted(() => vi.fn());

vi.mock("../../utils/fetchAndStoreLatestData.js", () => ({
  default: mockRefreshPublishedBlogData,
}));

import {
  buildFeatureImagePrompt,
  buildMetadataPrompt,
  chooseUniqueSlug,
  extractCmsRecordId,
  normalizeSummary,
  processCmsPagePropertyUpdate,
  processCmsPageUnlocked,
  reconcileCmsPageLocks,
  slugForTitle,
} from "../cms/blogCmsService.js";

const originalFetch = globalThis.fetch;
const originalNotionDatabaseId = process.env.NOTION_DATABASE_ID;
const originalNotionApiKey = process.env.NOTION_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.NOTION_DATABASE_ID = originalNotionDatabaseId;
  process.env.NOTION_API_KEY = originalNotionApiKey;
  mockRefreshPublishedBlogData.mockReset();
});

describe("blog CMS metadata helpers", () => {
  it("extracts the record ID from direct and Notion property webhook payloads", () => {
    expect(extractCmsRecordId({ cmsRecordId: 42 })).toBe(42);
    expect(extractCmsRecordId({ properties: { "CMS Record ID": { number: 7 } } })).toBe(7);
    expect(extractCmsRecordId({ properties: { "CMS Record ID": "BLOG-8" } })).toBe(8);
    expect(extractCmsRecordId({ recordId: "not-a-number" })).toBeNull();
  });

  it("normalizes preview-card summaries to a single bounded sentence", () => {
    expect(normalizeSummary("  A concise\n\nsummary.  ")).toBe("A concise summary.");
    expect(normalizeSummary("x".repeat(220))).toHaveLength(70);
  });

  it("creates deterministic slugs and resolves only real collisions", () => {
    expect(slugForTitle("A Reliable API: What Changed?")).toBe("a-reliable-api-what-changed");
    expect(chooseUniqueSlug("a-post", ["another-post"], "page-1")).toBe("a-post");
    expect(chooseUniqueSlug("a-post", ["a-post"], "page-1")).toMatch(/^a-post-[a-f0-9]{8}$/);
  });

  it("keeps the visual prompt post-specific and prevents rendered copy", () => {
    const metadataPrompt = buildMetadataPrompt({
      title: "A Better Cache",
      markdown: "## The problem\n\nCaching was slow.",
      existingTags: ["Engineering", "Performance"],
    });
    const imagePrompt = buildFeatureImagePrompt({
      title: "A Better Cache",
      summary: "An investigation into a slow cache.",
      imageBrief: "A cache node accelerating through a glowing data tunnel.",
    });

    expect(metadataPrompt).toContain("Engineering, Performance");
    expect(metadataPrompt).toContain("punchy, accurate share-preview sentence no longer than 70 characters");
    expect(imagePrompt).toContain("spacey hip-hop and cyberpunk editorial art");
    expect(imagePrompt).toContain("Do not render words");
    expect(imagePrompt).toContain("cache node");
  });

  it("refreshes public blog data when a published post receives a LinkedIn discussion URL", async () => {
    process.env.NOTION_DATABASE_ID = "cms-data-source";
    process.env.NOTION_API_KEY = "test-notion-key";
    const page = {
      id: "page-123",
      parent: { type: "data_source_id", id: "cms-data-source" },
      properties: {
        Published: { id: "published-property", checkbox: true },
        "LinkedIn Discussion URL": { id: "linkedin-property", url: "https://www.linkedin.com/posts/example" },
      },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }));

    await expect(processCmsPagePropertyUpdate("page-123", ["linkedin-property"]))
      .resolves.toEqual({ actions: ["publicData"] });

    expect(mockRefreshPublishedBlogData).toHaveBeenCalledOnce();
  });

  it("locks on publish and unlocks on normal unpublish", async () => {
    process.env.NOTION_DATABASE_ID = "cms-data-source";
    process.env.NOTION_API_KEY = "test-notion-key";
    const publishedPage = cmsPage({ published: true, isLocked: false, publicationDate: "", newsletterState: "" });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(publishedPage))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(processCmsPagePropertyUpdate("page-123", ["published-property"]))
      .resolves.toEqual({ actions: ["publication"] });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toMatchObject({
      is_locked: true,
      properties: {
        "Publication Date": { date: { start: expect.any(String) } },
        "Newsletter State": { select: { name: "Draft" } },
      },
    });

    const unpublishedPage = cmsPage({ published: false, isLocked: true, publicationDate: "2026-07-23T12:00:00.000Z", newsletterState: "Draft" });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unpublishedPage))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(processCmsPagePropertyUpdate("page-123", ["published-property"]))
      .resolves.toEqual({ actions: ["publication"] });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({ is_locked: false });
  });

  it("reconciles a published page lock even when Notion does not identify the changed property", async () => {
    process.env.NOTION_DATABASE_ID = "cms-data-source";
    process.env.NOTION_API_KEY = "test-notion-key";
    const publishedPage = cmsPage({ published: true, isLocked: false, publicationDate: "2026-07-23T12:00:00.000Z", newsletterState: "Draft" });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(publishedPage))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(processCmsPagePropertyUpdate("page-123", []))
      .resolves.toEqual({ actions: ["publication"] });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({ is_locked: true });
    expect(mockRefreshPublishedBlogData).toHaveBeenCalledOnce();
  });

  it("unpublishes and unlocks a live CMS page when Notion sends page.unlocked", async () => {
    process.env.NOTION_DATABASE_ID = "cms-data-source";
    process.env.NOTION_API_KEY = "test-notion-key";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(cmsPage({ published: true, isLocked: false })))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(processCmsPageUnlocked("page-123"))
      .resolves.toEqual({ actions: ["publication"] });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({
      is_locked: false,
      properties: { Published: { checkbox: false } },
    });
    expect(mockRefreshPublishedBlogData).toHaveBeenCalledOnce();
  });

  it("leaves already-draft and non-CMS page-unlocked events alone", async () => {
    process.env.NOTION_DATABASE_ID = "cms-data-source";
    process.env.NOTION_API_KEY = "test-notion-key";
    const nonCmsPage = cmsPage({ published: true, isLocked: false });
    nonCmsPage.parent = { type: "data_source_id", id: "another-data-source" };
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(cmsPage({ published: false, isLocked: false })))
      .mockResolvedValueOnce(jsonResponse(nonCmsPage));

    await expect(processCmsPageUnlocked("page-123")).resolves.toEqual({ actions: [] });
    await expect(processCmsPageUnlocked("page-other")).resolves.toEqual({ actions: [] });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(mockRefreshPublishedBlogData).not.toHaveBeenCalled();
  });

  it("reconciles existing CMS page locks without changing aligned pages", async () => {
    process.env.NOTION_DATABASE_ID = "cms-data-source";
    process.env.NOTION_API_KEY = "test-notion-key";
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        results: [
          cmsPage({ id: "published-unlocked", published: true, isLocked: false }),
          cmsPage({ id: "draft-locked", published: false, isLocked: true }),
          cmsPage({ id: "published-locked", published: true, isLocked: true }),
        ],
        has_more: false,
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(reconcileCmsPageLocks()).resolves.toEqual({
      inspected: 3,
      locked: 1,
      unlocked: 1,
      unchanged: 1,
    });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({ is_locked: true });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]?.body))).toEqual({ is_locked: false });
  });
});

function cmsPage(input: { id?: string; published: boolean; isLocked: boolean; publicationDate?: string; newsletterState?: string }) {
  return {
    id: input.id || "page-123",
    is_locked: input.isLocked,
    parent: { type: "data_source_id", id: "cms-data-source" },
    properties: {
      Published: { id: "published-property", checkbox: input.published },
      "Publication Date": { date: input.publicationDate ? { start: input.publicationDate } : null },
      "Newsletter State": { select: input.newsletterState ? { name: input.newsletterState } : null },
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

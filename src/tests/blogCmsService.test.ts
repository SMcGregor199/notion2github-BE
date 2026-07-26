import { afterEach, describe, expect, it, vi } from "vitest";

const mockRefreshPublishedBlogData = vi.hoisted(() => vi.fn());
const mockGetPageBodyMarkdown = vi.hoisted(() => vi.fn());

vi.mock("../../utils/fetchAndStoreLatestData.js", () => ({
  default: mockRefreshPublishedBlogData,
}));

vi.mock("../../utils/helper.js", () => ({
  getPageBodyMarkdown: mockGetPageBodyMarkdown,
}));

import {
  buildFeatureImagePrompt,
  buildMetadataPrompt,
  chooseUniqueSlug,
  extractCmsRecordId,
  initializeCmsMetadata,
  normalizeNewsletterIntro,
  normalizeSummary,
  processCmsPagePropertyUpdate,
  processCmsPageUnlocked,
  reconcileCmsPageLocks,
  slugForTitle,
} from "../cms/blogCmsService.js";

const originalFetch = globalThis.fetch;
const originalNotionDatabaseId = process.env.NOTION_DATABASE_ID;
const originalNotionApiKey = process.env.NOTION_API_KEY;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.NOTION_DATABASE_ID = originalNotionDatabaseId;
  process.env.NOTION_API_KEY = originalNotionApiKey;
  process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  mockRefreshPublishedBlogData.mockReset();
  mockGetPageBodyMarkdown.mockReset();
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

  it("normalizes generated newsletter intros to plain bounded text", () => {
    expect(normalizeNewsletterIntro("  I built this\n\nfor people who need a clearer path.  "))
      .toBe("I built this for people who need a clearer path.");
    expect(normalizeNewsletterIntro("x".repeat(700))).toHaveLength(600);
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
    expect(metadataPrompt).toContain("warm, personal first-person opening of one or two sentences");
    expect(metadataPrompt).toContain("no longer than 600 characters");
    expect(metadataPrompt).toContain("no markdown, greeting, subject line, or call to action");
    expect(imagePrompt).toContain("spacey hip-hop and cyberpunk editorial art");
    expect(imagePrompt).toContain("centered square safe area");
    expect(imagePrompt).toContain("central two-thirds of the canvas width");
    expect(imagePrompt).toContain("Do not render words");
    expect(imagePrompt).toContain("cache node");
  });

  it("generates a newsletter intro, requires it in the strict schema, and creates a draft when blank", async () => {
    const page = generationPage();
    const fetchMock = mockGenerationFetch(page);

    await expect(initializeCmsMetadata(9)).resolves.toEqual({ pageId: "page-123", skipped: false });

    const openAiRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/responses"));
    const schema = JSON.parse(String(openAiRequest?.[1]?.body)).text.format.schema;
    expect(schema.required).toContain("newsletterIntro");
    expect(schema.properties.newsletterIntro).toMatchObject({
      type: "string",
      maxLength: 600,
    });

    expect(generationUpdate(fetchMock)).toMatchObject({
      properties: {
        "Newsletter Intro": {
          rich_text: [{ type: "text", text: { content: "I've been thinking about how small engineering choices compound over time." } }],
        },
        "Newsletter State": { select: { name: "Draft" } },
        "Metadata State": { select: { name: "Ready" } },
      },
    });
  });

  it("replaces a generated newsletter intro without changing an existing newsletter state", async () => {
    const page = generationPage({ newsletterIntro: "Older intro.", newsletterState: "Sent" });
    const fetchMock = mockGenerationFetch(page);

    await initializeCmsMetadata(9);

    const properties = generationUpdate(fetchMock).properties;
    expect(properties["Newsletter Intro"]).toEqual({
      rich_text: [{ type: "text", text: { content: "I've been thinking about how small engineering choices compound over time." } }],
    });
    expect(properties).not.toHaveProperty("Newsletter State");
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
    const publishedPage = cmsPage({ published: true, isLocked: false, publicationDate: "" });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(publishedPage))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(processCmsPagePropertyUpdate("page-123", ["published-property"]))
      .resolves.toEqual({ actions: ["publication"] });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toMatchObject({
      is_locked: true,
      properties: {
        "Publication Date": { date: { start: expect.any(String) } },
      },
    });

    const unpublishedPage = cmsPage({ published: false, isLocked: true, publicationDate: "2026-07-23T12:00:00.000Z" });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unpublishedPage))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(processCmsPagePropertyUpdate("page-123", ["published-property"]))
      .resolves.toEqual({ actions: ["publication"] });

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({ is_locked: false });
  });

  it("creates a newsletter draft only after an intro is entered and clears an empty draft", async () => {
    process.env.NOTION_DATABASE_ID = "cms-data-source";
    process.env.NOTION_API_KEY = "test-notion-key";
    const pageWithIntro = cmsPage({ published: true, isLocked: true, newsletterIntro: "A new post is ready." });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(pageWithIntro))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(processCmsPagePropertyUpdate("page-123", ["newsletter-intro-property"]))
      .resolves.toEqual({ actions: ["newsletterDraft"] });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({
      properties: { "Newsletter State": { select: { name: "Draft" } } },
    });

    const pageWithEmptyDraft = cmsPage({ published: true, isLocked: true, newsletterState: "Draft" });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(pageWithEmptyDraft))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(processCmsPagePropertyUpdate("page-123", ["newsletter-intro-property"]))
      .resolves.toEqual({ actions: ["newsletterDraft"] });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({
      properties: { "Newsletter State": { select: null } },
    });
  });

  it("reconciles a published page lock even when Notion does not identify the changed property", async () => {
    process.env.NOTION_DATABASE_ID = "cms-data-source";
    process.env.NOTION_API_KEY = "test-notion-key";
    const publishedPage = cmsPage({ published: true, isLocked: false, publicationDate: "2026-07-23T12:00:00.000Z" });
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

function cmsPage(input: { id?: string; published: boolean; isLocked: boolean; publicationDate?: string; newsletterState?: string; newsletterIntro?: string }) {
  return {
    id: input.id || "page-123",
    is_locked: input.isLocked,
    parent: { type: "data_source_id", id: "cms-data-source" },
    properties: {
      Name: { title: [{ plain_text: "A Better Cache" }] },
      Published: { id: "published-property", checkbox: input.published },
      "Publication Date": { date: input.publicationDate ? { start: input.publicationDate } : null },
      "Newsletter Intro": {
        id: "newsletter-intro-property",
        rich_text: input.newsletterIntro ? [{ plain_text: input.newsletterIntro }] : [],
      },
      "Newsletter State": { select: input.newsletterState ? { name: input.newsletterState } : null },
    },
  };
}

function generationPage(input: { newsletterState?: string; newsletterIntro?: string } = {}) {
  return {
    ...cmsPage({ published: false, isLocked: false, ...input }),
    properties: {
      ...cmsPage({ published: false, isLocked: false, ...input }).properties,
      "Metadata State": { select: { name: "Queued" } },
    },
  };
}

function mockGenerationFetch(page: ReturnType<typeof generationPage>) {
  process.env.NOTION_DATABASE_ID = "cms-data-source";
  process.env.NOTION_API_KEY = "test-notion-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  mockGetPageBodyMarkdown.mockResolvedValue("## The problem\n\nCaching was slow.");

  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith("/data_sources/cms-data-source/query")) {
      const body = String(init?.body || "");
      return jsonResponse(body.includes("CMS Record ID")
        ? { results: [page], has_more: false }
        : { results: [], has_more: false });
    }
    if (requestUrl.endsWith("/data_sources/cms-data-source")) {
      return jsonResponse({ properties: { Tag: { select: { options: [{ name: "Engineering" }] } } } });
    }
    if (requestUrl.endsWith("/responses")) {
      return jsonResponse({
        output_text: JSON.stringify({
          summary: "A practical look at making cache decisions clearer.",
          tag: "Engineering",
          imageBrief: "A cache node accelerating through a glowing data tunnel.",
          newsletterIntro: "I've been thinking about how small engineering choices compound over time.",
        }),
      });
    }
    if (requestUrl.endsWith("/images/generations")) {
      return jsonResponse({ data: [{ b64_json: "aW1hZ2U=" }] });
    }
    if (requestUrl.endsWith("/file_uploads")) {
      return jsonResponse({ id: "upload-123", upload_url: "https://uploads.example.test/upload-123" });
    }
    if (requestUrl === "https://uploads.example.test/upload-123") {
      return new Response(null, { status: 200 });
    }
    if (requestUrl.endsWith("/pages/page-123")) {
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected fetch request: ${requestUrl}`);
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function generationUpdate(fetchMock: ReturnType<typeof vi.fn>) {
  const update = [...fetchMock.mock.calls]
    .reverse()
    .find(([url, init]) => String(url).endsWith("/pages/page-123") && init?.method === "PATCH");
  return JSON.parse(String(update?.[1]?.body));
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

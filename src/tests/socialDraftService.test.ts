import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetPageBodyMarkdown = vi.hoisted(() => vi.fn());

vi.mock("../../utils/helper.js", () => ({
  getPageBodyMarkdown: mockGetPageBodyMarkdown,
}));

import {
  buildSocialDraftPrompt,
  canonicalBlogUrl,
  generateSocialDraftsForPageId,
  SOCIAL_DRAFT_JSON_SCHEMA,
} from "../cms/socialDraftService.js";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  notionDatabaseId: process.env.NOTION_DATABASE_ID,
  notionSocialPostsDatabaseId: process.env.NOTION_SOCIAL_POSTS_DATABASE_ID,
  notionApiKey: process.env.NOTION_API_KEY,
  openAiApiKey: process.env.OPENAI_API_KEY,
  cmsTextModel: process.env.CMS_TEXT_MODEL,
};

beforeEach(() => {
  process.env.NOTION_DATABASE_ID = "cms-data-source";
  process.env.NOTION_SOCIAL_POSTS_DATABASE_ID = "social-data-source";
  process.env.NOTION_API_KEY = "test-notion-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.CMS_TEXT_MODEL = "test-text-model";
  mockGetPageBodyMarkdown.mockResolvedValue("## A useful idea\n\nThe article body.");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnvironment("NOTION_DATABASE_ID", originalEnvironment.notionDatabaseId);
  restoreEnvironment("NOTION_SOCIAL_POSTS_DATABASE_ID", originalEnvironment.notionSocialPostsDatabaseId);
  restoreEnvironment("NOTION_API_KEY", originalEnvironment.notionApiKey);
  restoreEnvironment("OPENAI_API_KEY", originalEnvironment.openAiApiKey);
  restoreEnvironment("CMS_TEXT_MODEL", originalEnvironment.cmsTextModel);
  mockGetPageBodyMarkdown.mockReset();
});

describe("social draft generation", () => {
  it("defines a strict three-pair schema and a platform-aware non-promotional prompt", () => {
    expect(SOCIAL_DRAFT_JSON_SCHEMA).toMatchObject({
      additionalProperties: false,
      properties: {
        pairs: {
          minItems: 3,
          maxItems: 3,
          items: {
            additionalProperties: false,
            required: ["sequence", "angle", "linkedin", "substack"],
          },
        },
      },
    });
    const prompt = buildSocialDraftPrompt({
      title: "Research Is a Design Material",
      markdown: "Research changes the shape of the work.",
      canonicalUrl: "https://shaynemcgregor.dev/blog/research-is-a-design-material",
      references: [],
    });
    expect(prompt).toContain("Launch, Follow-up 1, Follow-up 2");
    expect(prompt).toContain("separately written LinkedIn and Substack copy");
    expect(prompt).toContain("Do not use forced hashtags, engagement bait");
    expect(prompt).toContain("published posts only");
    expect(prompt).toContain("https://shaynemcgregor.dev/blog/research-is-a-design-material");
    expect(canonicalBlogUrl("/research-is-a-design-material/")).toBe(
      "https://shaynemcgregor.dev/blog/research-is-a-design-material",
    );
  });

  it("creates exactly six linked drafts, uses only published references, and ends Ready", async () => {
    const fetchMock = mockSuccessfulFetch();

    await expect(generateSocialDraftsForPageId("cms-page-1"))
      .resolves.toEqual({ pageId: "cms-page-1", created: 6 });

    const calls = fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init }));
    const referenceQueries = calls
      .filter(({ url, init }) => url.endsWith("/data_sources/social-data-source/query")
        && String(init?.body).includes('"Status"')
        && String(init?.body).includes('"Published"')
        && !String(init?.body).includes('"Blog CMS post"'));
    expect(referenceQueries).toHaveLength(4);
    expect(referenceQueries.every(({ init }) => String(init?.body).includes('"equals":"Published"'))).toBe(true);

    const openAiCall = calls.find(({ url }) => url.endsWith("/responses"));
    const openAiBody = JSON.parse(String(openAiCall?.init?.body));
    expect(openAiBody.model).toBe("test-text-model");
    expect(openAiBody.text.format).toMatchObject({
      type: "json_schema",
      name: "social_draft_pairs",
      strict: true,
    });
    expect(openAiBody.input).toContain("Published LinkedIn same-series voice.");
    expect(openAiBody.input).toContain("Published Substack same-series voice.");
    expect(openAiBody.input).not.toContain("Unreviewed draft voice");

    const creates = calls.filter(({ url, init }) => url.endsWith("/pages") && init?.method === "POST");
    expect(creates).toHaveLength(6);
    const createdBodies = creates.map(({ init }) => JSON.parse(String(init?.body)));
    expect(createdBodies.map((body) => [
      body.properties.Platform.select.name,
      body.properties.Sequence.select.name,
    ])).toEqual([
      ["LinkedIn", "Launch"],
      ["Substack", "Launch"],
      ["LinkedIn", "Follow-up 1"],
      ["Substack", "Follow-up 1"],
      ["LinkedIn", "Follow-up 2"],
      ["Substack", "Follow-up 2"],
    ]);
    for (const body of createdBodies) {
      expect(body.properties.Status).toEqual({ select: { name: "Draft" } });
      expect(body.properties.Origin).toEqual({ select: { name: "Generated" } });
      expect(body.properties["Blog CMS post"]).toEqual({ relation: [{ id: "cms-page-1" }] });
      expect(body.properties["Blog series"]).toEqual({ relation: [{ id: "series-1" }] });
      const copy = body.children
        .flatMap((block: any) => block.paragraph.rich_text)
        .map((richText: any) => richText.text.content)
        .join("\n\n");
      expect(copy).toContain("https://shaynemcgregor.dev/blog/research-is-a-design-material");
    }
    const createdCopy = createdBodies.map((body) => body.children
      .flatMap((block: any) => block.paragraph.rich_text)
      .map((richText: any) => richText.text.content)
      .join("\n\n"));
    expect(new Set(createdCopy).size).toBe(6);

    const stateUpdates = cmsStateUpdates(fetchMock);
    expect(stateUpdates.map((update) => update.properties["Social Draft State"].select.name))
      .toEqual(["Processing", "Ready"]);
    expect(stateUpdates.every((update) => Object.keys(update.properties).sort().join(",")
      === "Social Draft Error,Social Draft State")).toBe(true);
  });

  it.each([
    ["title", cmsPage({ title: "" }), "needs a title"],
    ["slug", cmsPage({ slug: "" }), "needs a slug"],
  ])("fails cleanly when the CMS %s is missing", async (_field, page, expectedMessage) => {
    const fetchMock = mockSuccessfulFetch({ page });

    await expect(generateSocialDraftsForPageId("cms-page-1")).rejects.toThrow(expectedMessage);

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/responses"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/pages") && init?.method === "POST")).toBe(false);
    const updates = cmsStateUpdates(fetchMock);
    expect(updates.at(-1)?.properties["Social Draft State"]).toEqual({ select: { name: "Failed" } });
    expect(updates.at(-1)?.properties["Social Draft Error"].rich_text[0].text.content).toContain(expectedMessage);
  });

  it("fails cleanly when the article body is missing", async () => {
    mockGetPageBodyMarkdown.mockResolvedValue("   ");
    const fetchMock = mockSuccessfulFetch();

    await expect(generateSocialDraftsForPageId("cms-page-1")).rejects.toThrow("needs article content");

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/responses"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/pages") && init?.method === "POST")).toBe(false);
    expect(cmsStateUpdates(fetchMock).at(-1)?.properties["Social Draft State"])
      .toEqual({ select: { name: "Failed" } });
  });

  it("does not overwrite an active social draft set", async () => {
    const fetchMock = mockSuccessfulFetch({ activeDraft: true });

    await expect(generateSocialDraftsForPageId("cms-page-1"))
      .rejects.toThrow("Mark every prior row Superseded");

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/responses"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/pages") && init?.method === "POST")).toBe(false);
    const activeQuery = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/data_sources/social-data-source/query")
      && String(init?.body).includes('"Blog CMS post"'));
    expect(String(activeQuery?.[1]?.body)).toContain('"equals":"Draft"');
    expect(String(activeQuery?.[1]?.body)).toContain('"equals":"Published"');
    expect(String(activeQuery?.[1]?.body)).not.toContain("Superseded");
    expect(cmsStateUpdates(fetchMock).at(-1)?.properties["Social Draft State"])
      .toEqual({ select: { name: "Failed" } });
  });

  it("creates no drafts when the model fails", async () => {
    const fetchMock = mockSuccessfulFetch({ modelFailure: true });

    await expect(generateSocialDraftsForPageId("cms-page-1"))
      .rejects.toThrow("OpenAI API request failed (503)");

    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/pages") && init?.method === "POST")).toBe(false);
    expect(cmsStateUpdates(fetchMock).at(-1)?.properties["Social Draft State"])
      .toEqual({ select: { name: "Failed" } });
  });

  it("creates no drafts when the Social Post Drafts data source is inaccessible", async () => {
    const fetchMock = mockSuccessfulFetch({ dataSourceFailure: true });

    await expect(generateSocialDraftsForPageId("cms-page-1"))
      .rejects.toThrow("Notion API request failed (403)");

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/responses"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/pages") && init?.method === "POST")).toBe(false);
    expect(cmsStateUpdates(fetchMock).at(-1)?.properties["Social Draft State"])
      .toEqual({ select: { name: "Failed" } });
  });

  it("archives a partial set if a Notion create fails", async () => {
    const fetchMock = mockSuccessfulFetch({ failCreateNumber: 2 });

    await expect(generateSocialDraftsForPageId("cms-page-1"))
      .rejects.toThrow("Notion API request failed (503)");

    const archiveCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/pages/generated-1")
      && init?.method === "PATCH"
      && String(init.body).includes('"archived":true'));
    expect(archiveCall).toBeTruthy();
    expect(cmsStateUpdates(fetchMock).at(-1)?.properties["Social Draft State"])
      .toEqual({ select: { name: "Failed" } });
  });
});

function mockSuccessfulFetch(input: {
  page?: ReturnType<typeof cmsPage>;
  activeDraft?: boolean;
  modelFailure?: boolean;
  dataSourceFailure?: boolean;
  failCreateNumber?: number;
} = {}) {
  const page = input.page || cmsPage();
  let createCount = 0;
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const requestUrl = String(url);
    if (requestUrl.endsWith("/pages/cms-page-1") && (!init?.method || init.method === "GET")) {
      return jsonResponse(page);
    }
    if (requestUrl.endsWith("/pages/cms-page-1") && init?.method === "PATCH") {
      return jsonResponse({ id: "cms-page-1" });
    }
    if (requestUrl.endsWith("/data_sources/social-data-source") && (!init?.method || init.method === "GET")) {
      if (input.dataSourceFailure) return new Response("not shared", { status: 403 });
      return jsonResponse(socialDataSource());
    }
    if (requestUrl.endsWith("/data_sources/social-data-source/query")) {
      const body = String(init?.body || "");
      if (body.includes('"Blog CMS post"')) {
        return jsonResponse({ results: input.activeDraft ? [{ id: "active-draft" }] : [], has_more: false });
      }
      const platform = body.includes('"LinkedIn"') ? "LinkedIn" : "Substack";
      const sameSeries = body.includes('"Blog series"');
      if (sameSeries) {
        return jsonResponse({ results: [referencePage(`${platform.toLowerCase()}-same`, platform, true)], has_more: false });
      }
      return jsonResponse({
        results: [
          referencePage(`${platform.toLowerCase()}-same`, platform, true),
          referencePage(`${platform.toLowerCase()}-other`, platform, false),
        ],
        has_more: false,
      });
    }
    if (requestUrl.includes("/blocks/linkedin-same/children")) {
      return blocksResponse("Published LinkedIn same-series voice.");
    }
    if (requestUrl.includes("/blocks/linkedin-other/children")) {
      return blocksResponse("Published LinkedIn general voice.");
    }
    if (requestUrl.includes("/blocks/substack-same/children")) {
      return blocksResponse("Published Substack same-series voice.");
    }
    if (requestUrl.includes("/blocks/substack-other/children")) {
      return blocksResponse("Published Substack general voice.");
    }
    if (requestUrl.endsWith("/responses")) {
      if (input.modelFailure) return new Response("model unavailable", { status: 503 });
      return jsonResponse({ output_text: JSON.stringify(generatedPairs()) });
    }
    if (requestUrl.endsWith("/pages") && init?.method === "POST") {
      createCount += 1;
      if (input.failCreateNumber === createCount) return new Response("create unavailable", { status: 503 });
      return jsonResponse({ id: `generated-${createCount}` });
    }
    if (requestUrl.includes("/pages/generated-") && init?.method === "PATCH") {
      return jsonResponse({ archived: true });
    }
    throw new Error(`Unexpected fetch request: ${requestUrl}`);
  });
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function cmsPage(input: { title?: string; slug?: string } = {}) {
  return {
    id: "cms-page-1",
    parent: { type: "data_source_id", id: "cms-data-source" },
    properties: {
      Name: { type: "title", title: input.title === "" ? [] : [{ plain_text: input.title || "Research Is a Design Material" }] },
      Slug: { type: "rich_text", rich_text: input.slug === "" ? [] : [{ plain_text: input.slug || "research-is-a-design-material" }] },
      Series: { type: "relation", relation: [{ id: "series-1" }] },
      "Social Draft State": { type: "select", select: { name: "Queued" } },
      "Social Draft Error": { type: "rich_text", rich_text: [] },
    },
  };
}

function socialDataSource() {
  return {
    properties: {
      Name: { type: "title" },
      Platform: { type: "select" },
      Sequence: { type: "select" },
      Status: { type: "select" },
      "Blog CMS post": { type: "relation" },
      "Blog series": { type: "relation" },
      "Published at": { type: "date" },
      "Publication URL": { type: "url" },
      Origin: { type: "select" },
    },
  };
}

function referencePage(id: string, platform: string, sameSeries: boolean) {
  return {
    id,
    properties: {
      Platform: { select: { name: platform } },
      Status: { select: { name: "Published" } },
      "Published at": { date: { start: "2026-07-01" } },
      "Blog series": { relation: sameSeries ? [{ id: "series-1" }] : [] },
    },
  };
}

function generatedPairs() {
  return {
    pairs: [
      { sequence: "Launch", angle: "Why research changes design", linkedin: "LinkedIn launch copy.", substack: "Substack launch copy." },
      { sequence: "Follow-up 1", angle: "A useful research practice", linkedin: "LinkedIn useful idea.", substack: "Substack useful idea." },
      { sequence: "Follow-up 2", angle: "A question about evidence", linkedin: "LinkedIn reflection.", substack: "Substack reflection." },
    ],
  };
}

function blocksResponse(content: string): Response {
  return jsonResponse({
    results: [{ type: "paragraph", paragraph: { rich_text: [{ plain_text: content }] } }],
    has_more: false,
  });
}

function cmsStateUpdates(fetchMock: ReturnType<typeof vi.fn>): any[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith("/pages/cms-page-1") && init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

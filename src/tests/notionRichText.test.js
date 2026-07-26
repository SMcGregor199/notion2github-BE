import { describe, expect, it } from "vitest";
import {
  getBodyBlocksFromPageContent,
  buildSeriesById,
  getDateProperty,
  getLinkedInDiscussionUrlFromPage,
  enrichPostWithSeries,
  getConfiguredSeriesById,
  getSeriesRelationId,
  getValidLinkedInDiscussionUrl,
  getPageBodyMarkdown,
  isPublishedDatabasePage,
  serializeNotionBodyBlocks,
  serializeNotionBlock,
  serializeRichText,
} from "../../utils/helper.js";

describe("Notion rich text serialization", () => {
  it("keeps unlinked paragraphs as plain strings", () => {
    expect(serializeRichText([
      { plain_text: "Plain " },
      { plain_text: "paragraph." },
    ])).toBe("Plain paragraph.");
  });

  it("serializes linked paragraphs as text spans with hrefs", () => {
    expect(serializeRichText([
      { plain_text: "Read " },
      {
        plain_text: "the guide",
        href: "https://example.com/guide",
        text: { link: { url: "https://example.com/guide" } },
      },
      { plain_text: "." },
    ])).toEqual([
      { text: "Read " },
      { text: "the guide", href: "https://example.com/guide" },
      { text: "." },
    ]);
  });

  it("serializes bold paragraphs as text spans with bold metadata", () => {
    expect(serializeRichText([
      { plain_text: "This is " },
      { plain_text: "important", annotations: { bold: true } },
      { plain_text: "." },
    ])).toEqual([
      { text: "This is " },
      { text: "important", bold: true },
      { text: "." },
    ]);
  });

  it("serializes linked bold text with href and bold metadata", () => {
    expect(serializeRichText([
      { plain_text: "Read " },
      {
        plain_text: "the guide",
        href: "https://example.com/guide",
        annotations: { bold: true },
        text: { link: { url: "https://example.com/guide" } },
      },
      { plain_text: "." },
    ])).toEqual([
      { text: "Read " },
      { text: "the guide", href: "https://example.com/guide", bold: true },
      { text: "." },
    ]);
  });

  it("serializes common Notion blocks without relying on heading and paragraph-only content", () => {
    expect(serializeNotionBodyBlocks([
      { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Main" }] } },
      { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "Bullet" }] } },
      { type: "numbered_list_item", numbered_list_item: { rich_text: [{ plain_text: "Step" }] } },
      { type: "quote", quote: { rich_text: [{ plain_text: "Quoted" }] } },
      { type: "to_do", to_do: { checked: true, rich_text: [{ plain_text: "Done" }] } },
      { type: "code", code: { language: "javascript", rich_text: [{ plain_text: "console.log('hi');" }] } },
      { type: "divider", divider: {} },
    ])).toEqual([
      {
        heading: "",
        paras: [],
        blocks: [
          { type: "heading_1", text: "Main" },
          { type: "bulleted_list_item", text: "Bullet" },
          { type: "numbered_list_item", text: "Step" },
          { type: "quote", text: "Quoted" },
          { type: "to_do", text: "Done", checked: true },
          { type: "code", text: "console.log('hi');", language: "javascript" },
          { type: "divider" },
        ],
      },
    ]);
  });

  it("keeps legacy paragraph fields while adding rich blocks", () => {
    expect(serializeNotionBodyBlocks([
      { type: "heading_3", heading_3: { rich_text: [{ plain_text: "Section" }] } },
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Paragraph." }] } },
    ])).toEqual([
      {
        heading: "Section",
        paras: ["Paragraph."],
        blocks: [
          { type: "heading_3", text: "Section" },
          { type: "paragraph", text: "Paragraph." },
        ],
      },
    ]);
  });

  it("serializes unsupported Notion blocks as text fallbacks instead of dropping them", () => {
    expect(serializeNotionBlock({
      type: "synced_block",
      synced_block: { rich_text: [{ plain_text: "Fallback text" }] },
    })).toEqual({
      type: "unsupported",
      originalType: "synced_block",
      text: "Fallback text",
    });
  });

  it("removes legacy summary and tag metadata blocks from page body content", () => {
    const blocks = getBodyBlocksFromPageContent({
      results: [
        { type: "heading_3", heading_3: { rich_text: [{ plain_text: "Legacy summary" }] } },
        { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Actual body." }] } },
        { type: "to_do", to_do: { rich_text: [{ plain_text: "Tag: " }, { plain_text: "EdTech" }] } },
      ],
    });

    expect(blocks).toEqual([
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Actual body." }] } },
    ]);
  });

  it("keeps first headings for database posts that use properties for metadata", () => {
    const firstHeading = {
      type: "heading_3",
      heading_3: { rich_text: [{ plain_text: "The First Point of Friction" }] },
    };
    const blocks = getBodyBlocksFromPageContent({
      results: [
        firstHeading,
        { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Actual body." }] } },
      ],
    }, { stripLegacyMetadata: false });

    expect(blocks).toEqual([
      firstHeading,
      { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Actual body." }] } },
    ]);
  });

  it("treats only checked Notion database pages as published", () => {
    expect(isPublishedDatabasePage({
      properties: {
        Published: { type: "checkbox", checkbox: true },
      },
    })).toBe(true);

    expect(isPublishedDatabasePage({
      properties: {
        Published: { type: "checkbox", checkbox: false },
      },
    })).toBe(false);

    expect(isPublishedDatabasePage({ properties: {} })).toBe(false);
  });

  it("reads Notion date properties for publication dates", () => {
    expect(getDateProperty({
      properties: {
        "Publication Date": {
          type: "date",
          date: { start: "2026-01-10T13:58:01.000Z", end: null },
        },
      },
    }, "Publication Date")).toBe("2026-01-10T13:58:01.000Z");

    expect(getDateProperty({ properties: {} }, "Publication Date")).toBe("");
  });

  it("enriches a published post with the related public series metadata", () => {
    const seriesById = buildSeriesById([{
      id: "series-1",
      properties: {
        Name: { type: "title", title: [{ plain_text: "The Design of Research" }] },
        Slug: { type: "rich_text", rich_text: [{ plain_text: "the-design-of-research" }] },
        Description: { type: "rich_text", rich_text: [{ plain_text: "How research takes shape." }] },
      },
    }]);
    const page = {
      properties: {
        Published: { type: "checkbox", checkbox: true },
        Series: { type: "relation", relation: [{ id: "series-1" }] },
      },
    };

    expect(isPublishedDatabasePage(page)).toBe(true);
    expect(getSeriesRelationId(page)).toBe("series-1");
    expect(enrichPostWithSeries({ title: "Part one" }, page, seriesById)).toEqual({
      title: "Part one",
      series: {
        name: "The Design of Research",
        slug: "the-design-of-research",
        description: "How research takes shape.",
      },
    });
  });

  it("keeps drafts and malformed or unavailable series records out of public series data", () => {
    const draft = {
      properties: {
        Published: { type: "checkbox", checkbox: false },
        Series: { type: "relation", relation: [{ id: "series-missing" }] },
      },
    };
    const malformedSeries = buildSeriesById([{
      id: "series-missing",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Missing a slug" }] },
        Slug: { type: "rich_text", rich_text: [] },
      },
    }]);

    expect(isPublishedDatabasePage(draft)).toBe(false);
    expect(malformedSeries.size).toBe(0);
    expect(enrichPostWithSeries({ title: "Draft post" }, draft, malformedSeries)).toEqual({ title: "Draft post" });
    expect(enrichPostWithSeries({ title: "No configured series" }, {
      properties: { Series: { type: "relation", relation: [{ id: "series-1" }] } },
    }, new Map())).toEqual({ title: "No configured series" });
  });

  it("omits series data when its source is absent or misconfigured", async () => {
    const originalSeriesDatabaseId = process.env.NOTION_BLOG_SERIES_DATABASE_ID;
    try {
      delete process.env.NOTION_BLOG_SERIES_DATABASE_ID;
      await expect(getConfiguredSeriesById()).resolves.toEqual(new Map());

      process.env.NOTION_BLOG_SERIES_DATABASE_ID = "misconfigured-series-source";
      await expect(getConfiguredSeriesById(async () => {
        throw new Error("Notion data source unavailable");
      })).resolves.toEqual(new Map());
    } finally {
      if (originalSeriesDatabaseId === undefined) delete process.env.NOTION_BLOG_SERIES_DATABASE_ID;
      else process.env.NOTION_BLOG_SERIES_DATABASE_ID = originalSeriesDatabaseId;
    }
  });

  it("accepts only HTTPS LinkedIn discussion URLs for public post data", () => {
    expect(getValidLinkedInDiscussionUrl(" https://www.linkedin.com/posts/example_123 ")).toBe(
      "https://www.linkedin.com/posts/example_123",
    );
    expect(getValidLinkedInDiscussionUrl("http://www.linkedin.com/posts/example")).toBe("");
    expect(getValidLinkedInDiscussionUrl("https://linkedin.example.com/posts/example")).toBe("");
    expect(getValidLinkedInDiscussionUrl("https://www.linkedin.com@evil.example/posts/example")).toBe("");
    expect(getValidLinkedInDiscussionUrl("")).toBe("");
  });

  it("extracts a valid LinkedIn discussion URL and omits missing or invalid Notion properties", () => {
    expect(getLinkedInDiscussionUrlFromPage({
      properties: {
        "LinkedIn Discussion URL": { type: "url", url: "https://www.linkedin.com/posts/example_123" },
      },
    })).toBe("https://www.linkedin.com/posts/example_123");
    expect(getLinkedInDiscussionUrlFromPage({ properties: {} })).toBe("");
    expect(getLinkedInDiscussionUrlFromPage({
      properties: {
        "LinkedIn Discussion URL": { type: "url", url: "https://example.com/not-linkedin" },
      },
    })).toBe("");
  });

  it("can omit a legacy image block from Markdown when it is promoted to the featured image", async () => {
    const markdown = await getPageBodyMarkdown("page-1", {
      results: [
        {
          id: "text-1",
          type: "paragraph",
          paragraph: {
            rich_text: [
              {
                type: "text",
                plain_text: "Body text.",
                annotations: {},
                text: { content: "Body text.", link: null },
              },
            ],
          },
        },
        {
          id: "image-1",
          type: "image",
          image: {
            type: "external",
            external: { url: "https://example.com/image.webp" },
            caption: [{ plain_text: "Legacy featured image" }],
          },
        },
      ],
    }, { excludeBlockId: "image-1" });

    expect(markdown).toContain("Body text.");
    expect(markdown).not.toContain("Legacy featured image");
    expect(markdown).not.toContain("example.com/image.webp");
  });
});

import { describe, expect, it } from "vitest";
import {
  getBodyBlocksFromPageContent,
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
});

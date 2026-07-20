import { describe, expect, it } from "vitest";
import {
  buildFeatureImagePrompt,
  buildMetadataPrompt,
  chooseUniqueSlug,
  extractCmsRecordId,
  normalizeSummary,
  slugForTitle,
} from "../cms/blogCmsService.js";

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
});

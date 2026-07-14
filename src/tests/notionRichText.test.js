import { describe, expect, it } from "vitest";
import { serializeRichText } from "../../utils/helper.js";

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
});

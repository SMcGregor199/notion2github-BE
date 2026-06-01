import {describe, expect, it} from "vitest";
// @ts-ignore - This runtime JS helper is imported by the Netlify function and tested here.
import { getNotionImageBlock, getNotionImageUrl, getNotionImageUrlFromPageContent } from "../../utils/notionImage.js";

describe("notion image helpers", () => {
    it("returns the file url for a Notion file image", () => {
        const pageContent = {
            results: [
                {
                    type: "image",
                    image: {
                        type: "file",
                        file: {
                            url: "https://example.com/file.webp",
                        },
                    },
                },
            ],
        };

        expect(getNotionImageBlock(pageContent)).toBe(pageContent.results[0]);
        expect(getNotionImageUrl(pageContent.results[0])).toBe("https://example.com/file.webp");
        expect(getNotionImageUrlFromPageContent(pageContent)).toBe("https://example.com/file.webp");
    });

    it("returns the external url for a Notion external image", () => {
        const pageContent = {
            results: [
                {
                    type: "image",
                    image: {
                        type: "external",
                        external: {
                            url: "https://example.com/external.webp",
                        },
                    },
                },
            ],
        };

        expect(getNotionImageUrlFromPageContent(pageContent)).toBe("https://example.com/external.webp");
    });

    it("returns null when the image block is missing or malformed", () => {
        expect(getNotionImageUrlFromPageContent({ results: [] })).toBeNull();
        expect(getNotionImageUrl(null)).toBeNull();
        expect(getNotionImageUrl({ image: { type: "file" } })).toBeNull();
    });
});

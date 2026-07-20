// @ts-ignore - Image source registry is shared JavaScript used by Netlify functions.
import { createStableImageId, notionImageSourceFingerprint } from "../../utils/notionPublicImages.js";
import { describe, expect, it } from "vitest";

describe("public Notion image identifiers", () => {
  it("keeps a semantic image id stable when a Notion download URL is renewed", () => {
    expect(createStableImageId("page-1", "feature-image")).toBe(createStableImageId("page-1", "feature-image"));
  });

  it("ignores changing AWS signing parameters when comparing a Notion-hosted file", () => {
    const first = "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/image.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=first";
    const renewed = "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/image.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=renewed";

    expect(notionImageSourceFingerprint(first)).toBe(notionImageSourceFingerprint(renewed));
  });

  it("treats distinct external image URLs as distinct source revisions", () => {
    expect(notionImageSourceFingerprint("https://images.example/post.png?v=1"))
      .not.toBe(notionImageSourceFingerprint("https://images.example/post.png?v=2"));
  });
});

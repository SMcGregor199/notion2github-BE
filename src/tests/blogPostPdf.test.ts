import { describe, expect, it, vi } from "vitest";
import { imageDisplayLayout, serveBlogPostPdf } from "../pdf/blogPostPdf.js";

const post = {
  link: "a-useful-post",
  title: "A Useful Post",
  summary: "A short post summary.",
  tag: "Engineering",
  publishedDate: "2026-07-24T12:00:00.000Z",
  updatedDate: "",
  thumbnail: "",
  body: [{
    heading: "",
    paras: [],
    blocks: [
      { type: "heading_2", text: "The first section" },
      { type: "paragraph", text: "A paragraph that belongs in the downloaded document." },
      { type: "quote", text: "A useful quotation." },
    ],
  }],
  bodyMarkdown: "",
};

function contentStore(posts: unknown = [post]) {
  return {
    get: vi.fn(async (key: string) => key === "content/manifest.json" ? { current_key: "content/version.json" } : posts),
  };
}

describe("blog post PDF response", () => {
  it("uses each image's actual display dimensions instead of a fixed page reservation", () => {
    expect(imageDisplayLayout(1200, 400, 483, 360)).toEqual({ width: 483, height: 161 });
    expect(imageDisplayLayout(400, 1200, 483, 360)).toEqual({ width: 120, height: 360 });
    expect(imageDisplayLayout(400, 1200, 483, 220)).toEqual({ width: 73.33, height: 220 });
    expect(imageDisplayLayout(400, 1200, 483, 0)).toBeNull();
    expect(imageDisplayLayout(undefined, 400, 483, 360)).toBeNull();
  });

  it("returns a downloadable branded PDF for the requested published post", async () => {
    const response = await serveBlogPostPdf({
      store: contentStore(),
      request: new Request("https://example.test/.netlify/functions/blog-post-pdf?slug=a-useful-post"),
      fetchImplementation: vi.fn(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="a-useful-post.pdf"');
    expect(response.headers.get("Cache-Control")).toContain("max-age=300");
    const pdf = Buffer.from(await response.arrayBuffer()).toString("latin1");
    expect(pdf).toContain("A Useful Post");
    expect(pdf).toContain("/URI (https://shaynemcgregor.dev/blog/a-useful-post)");
    expect(pdf).toContain("/Count 1");
  });

  it("returns 404 for invalid and missing post slugs", async () => {
    const invalid = await serveBlogPostPdf({
      store: contentStore(),
      request: new Request("https://example.test/.netlify/functions/blog-post-pdf?slug=not/a-slug"),
    });
    const missing = await serveBlogPostPdf({
      store: contentStore(),
      request: new Request("https://example.test/.netlify/functions/blog-post-pdf?slug=missing-post"),
    });

    expect(invalid.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it("returns 503 when current published content is unavailable", async () => {
    const response = await serveBlogPostPdf({
      store: { get: vi.fn(async () => null) },
      request: new Request("https://example.test/.netlify/functions/blog-post-pdf?slug=a-useful-post"),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects non-GET requests", async () => {
    const response = await serveBlogPostPdf({
      store: contentStore(),
      request: new Request("https://example.test/.netlify/functions/blog-post-pdf?slug=a-useful-post", { method: "POST" }),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });

  it("still creates a PDF when an image cannot be fetched", async () => {
    const response = await serveBlogPostPdf({
      store: contentStore([{ ...post, thumbnail: "https://images.example.test/missing.png" }]),
      request: new Request("https://example.test/.netlify/functions/blog-post-pdf?slug=a-useful-post"),
      fetchImplementation: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
      logger: { error: vi.fn(), warn: vi.fn() },
    });

    expect(response.status).toBe(200);
  });

  it("supports Markdown-backed posts when structured blocks are unavailable", async () => {
    const response = await serveBlogPostPdf({
      store: contentStore([{ ...post, body: [], bodyMarkdown: "## Markdown heading\n\nMarkdown body copy." }]),
      request: new Request("https://example.test/.netlify/functions/blog-post-pdf?slug=a-useful-post"),
      fetchImplementation: vi.fn(),
    });

    expect(response.status).toBe(200);
  });
});

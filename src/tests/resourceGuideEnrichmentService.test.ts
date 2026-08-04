import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractResourceArticle,
  fetchPublicHtml,
  normalizeGeneratedResourceMetadata,
  normalizeTags,
  processResourceGuidePagePropertyUpdate,
  validatePublicHttpUrl,
} from "../resources/resourceGuideEnrichmentService.js";

const publicLookup = async () => [{ address: "8.8.8.8", family: 4 }];
const readableHtml = `<html><head><meta property="og:title" content="A useful study"><meta property="article:author" content="Ada Author"><meta property="article:published_time" content="2026-06-12T12:00:00Z"><meta property="og:site_name" content="Research Journal"></head><body><article>${Array.from({ length: 90 }, (_, index) => `Evidence${index}`).join(" ")}</article></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NOTION_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.NOTION_RESOURCES_DATABASE_ID;
});

describe("Resource Guide URL enrichment", () => {
  it("rejects local, private, and privately resolved source URLs", async () => {
    await expect(validatePublicHttpUrl("http://127.0.0.1/article", publicLookup)).rejects.toThrow("Local, private");
    await expect(validatePublicHttpUrl("https://localhost/article", publicLookup)).rejects.toThrow("Local, private");
    await expect(validatePublicHttpUrl("https://private-source.invalid-domain/article", async () => [{ address: "10.0.0.8", family: 4 }])).rejects.toThrow("public internet");
  });

  it("follows only safe redirects and rejects non-HTML and oversized responses", async () => {
    const safeFetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://8.8.8.8/final" } }))
      .mockResolvedValueOnce(new Response("<article>ok</article>", { headers: { "Content-Type": "text/html" } }));
    await expect(fetchPublicHtml("https://8.8.8.8/start", { fetchImpl: safeFetch, lookup: publicLookup })).resolves.toMatchObject({ finalUrl: "https://8.8.8.8/final" });

    await expect(fetchPublicHtml("https://8.8.8.8/file", {
      fetchImpl: vi.fn().mockResolvedValue(new Response("pdf", { headers: { "Content-Type": "application/pdf" } })), lookup: publicLookup,
    })).rejects.toThrow("not an HTML");
    await expect(fetchPublicHtml("https://8.8.8.8/large", {
      fetchImpl: vi.fn().mockResolvedValue(new Response("large", { headers: { "Content-Type": "text/html", "Content-Length": "999" } })), lookup: publicLookup, maxBytes: 10,
    })).rejects.toThrow("too large");
  });

  it("extracts document metadata and fails visibly when no meaningful article text exists", () => {
    expect(extractResourceArticle(readableHtml, "https://example.test/a")).toMatchObject({
      title: "A useful study", author: "Ada Author", publisher: "Research Journal", publicationDate: "2026-06-12",
    });
    expect(() => extractResourceArticle("<html><title>Paywall</title><body>Subscribe</body></html>", "https://example.test/a"))
      .toThrow("No readable article text");
  });

  it("constrains generated taxonomy fields and creates clean, deduplicated tags", () => {
    const result = normalizeGeneratedResourceMetadata({
      title: "Generated title", category: "studies & evidence", resourceType: "Wrong type",
      disciplines: ["Education", "Unknown", "education"], researchStages: ["Literature Review"], aiRoles: ["Augmentation"],
      tags: ["ai", "AI", "llm methods", "un policy"], description: "A concise summary.",
    }, {
      categories: ["Studies & Evidence"], resourceTypes: ["Study"], disciplines: ["Education"], researchStages: ["Literature Review"], aiRoles: ["Augmentation"], tags: ["Existing"],
    }, { title: "Fallback", author: "", publicationDate: "", publisher: "" });

    expect(result).toMatchObject({ category: "Studies & Evidence", resourceType: "", disciplines: ["Education"], tags: ["AI", "LLM Methods", "UN Policy"] });
    expect(normalizeTags(["ai", "AI", "research methods"])).toEqual(["AI", "Research Methods"]);
  });

  it("moves queued pages through processing and ready without writing manual fields, and ignores a duplicate event", async () => {
    process.env.NOTION_API_KEY = "notion";
    process.env.OPENAI_API_KEY = "openai";
    process.env.NOTION_RESOURCES_DATABASE_ID = "resources-source";
    let state = "Queued";
    const patches: Array<Record<string, unknown>> = [];
    const page = () => ({
      id: "resource-1", parent: { type: "data_source_id", id: "resources-source" }, properties: {
        Name: { id: "name", type: "title", title: [] }, URL: { id: "url", type: "url", url: "https://8.8.8.8/article" },
        "Publication Status": { id: "status", type: "select", select: { name: "Draft" } },
        "Enrichment State": { id: "enrich-state", type: "select", select: { name: state } }, "Enrichment Error": { id: "enrich-error", type: "rich_text", rich_text: [] },
        "Public Annotation": { id: "annotation", type: "rich_text", rich_text: [{ plain_text: "Manual" }] }, "Private Research Notes": { id: "notes", type: "rich_text", rich_text: [] },
        Featured: { id: "featured", type: "checkbox", checkbox: false }, "Sort Priority": { id: "priority", type: "number", number: 2 },
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/pages/resource-1") && init?.method === "PATCH") {
        const properties = JSON.parse(String(init.body)).properties;
        patches.push(properties);
        state = properties["Enrichment State"].select.name;
        return new Response("{}", { status: 200 });
      }
      if (url.endsWith("/pages/resource-1")) return Response.json(page());
      if (url.endsWith("/data_sources/resources-source")) return Response.json({ id: "resources-source", properties: {
        "Resource Category": { select: { options: [{ name: "Studies & Evidence" }] } }, "Resource Type": { select: { options: [{ name: "Study" }] } },
        Discipline: { multi_select: { options: [{ name: "Education" }] } }, "Research-process Stage": { multi_select: { options: [{ name: "Literature Review" }] } },
        "AI Role / Intervention": { multi_select: { options: [{ name: "Augmentation" }] } }, Tags: { multi_select: { options: [{ name: "Existing" }] } },
      } });
      if (url === "https://8.8.8.8/article") return new Response(readableHtml, { headers: { "Content-Type": "text/html" } });
      if (url.endsWith("/responses")) return Response.json({ output_text: JSON.stringify({ title: "Generated resource", source: "Research Journal", creator: "Ada", publicationDate: "2026-06-12", category: "Studies & Evidence", resourceType: "Study", disciplines: ["Education"], researchStages: ["Literature Review"], aiRoles: ["Augmentation"], tags: ["ai", "new tag"], description: "Useful evidence." }) });
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(processResourceGuidePagePropertyUpdate("resource-1", ["enrich-state"])).resolves.toEqual({ actions: ["enrichment"] });
    await expect(processResourceGuidePagePropertyUpdate("resource-1", ["enrich-state"])).resolves.toEqual({ actions: [] });
    const finalPatch = patches.at(-1)!;
    expect(finalPatch).toMatchObject({ "Enrichment State": { select: { name: "Ready" } }, Tags: { multi_select: [{ name: "AI" }, { name: "New Tag" }] } });
    expect(Object.keys(finalPatch)).not.toEqual(expect.arrayContaining(["URL", "Public Annotation", "Private Research Notes", "Publication Status", "Featured", "Sort Priority"]));
  });

  it("records a recovery-oriented failed state for a blocked source", async () => {
    process.env.NOTION_API_KEY = "notion";
    process.env.OPENAI_API_KEY = "openai";
    process.env.NOTION_RESOURCES_DATABASE_ID = "resources-source";
    const patches: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/pages/resource-1") && init?.method === "PATCH") { const p = JSON.parse(String(init.body)).properties; patches.push(p); return Response.json({}); }
      if (url.endsWith("/pages/resource-1")) return Response.json({ id: "resource-1", parent: { type: "data_source_id", id: "resources-source" }, properties: { URL: { type: "url", url: "https://8.8.8.8/blocked" }, "Enrichment State": { type: "select", select: { name: "Queued" } }, "Publication Status": { type: "select", select: { name: "Draft" } } } });
      if (url.endsWith("/data_sources/resources-source")) return Response.json({ id: "resources-source", properties: { "Resource Category": { select: { options: [{ name: "Studies & Evidence" }] } } } });
      if (url === "https://8.8.8.8/blocked") return new Response("blocked", { status: 403, headers: { "Content-Type": "text/html" } });
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    await expect(processResourceGuidePagePropertyUpdate("resource-1", [])).resolves.toEqual({ actions: ["failed"] });
    expect(patches.at(-1)).toMatchObject({ "Enrichment State": { select: { name: "Failed" } } });
  });

  it("invalidates only the Resource Guide manifest for published public-data changes", async () => {
    process.env.NOTION_API_KEY = "notion";
    process.env.NOTION_RESOURCES_DATABASE_ID = "resources-source";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/pages/resource-1")) return Response.json({
        id: "resource-1", parent: { type: "data_source_id", id: "resources-source" }, properties: {
          Name: { id: "title-id", type: "title", title: [] }, "Publication Status": { id: "status-id", type: "select", select: { name: "Published" } },
          "Enrichment State": { id: "state-id", type: "select", select: { name: "Ready" } },
        },
      });
      if (url.endsWith("/data_sources/resources-source")) return Response.json({ id: "resources-source", properties: {} });
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    const store = { delete: vi.fn().mockResolvedValue(undefined) };
    await expect(processResourceGuidePagePropertyUpdate("resource-1", ["title-id"], store)).resolves.toEqual({ actions: ["cacheInvalidated"] });
    expect(store.delete).toHaveBeenCalledWith("guide/manifest.json");
  });
});

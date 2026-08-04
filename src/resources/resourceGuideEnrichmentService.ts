import { lookup as dnsLookup } from "node:dns/promises";
import { RESOURCE_GUIDE_PROPERTIES, invalidateResourceGuideManifest } from "./resourceGuideService.js";
import type { ResourceGuideStore } from "./types.js";

const NOTION_API_BASE = "https://api.notion.com/v1";
const OPENAI_API_BASE = "https://api.openai.com/v1";
const NOTION_VERSION = "2026-03-11";
const DEFAULT_TEXT_MODEL = "gpt-5.6-luna";
const MAX_REDIRECTS = 4;
const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const MIN_ARTICLE_WORDS = 60;

export type PublicHostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const publicHostLookup: PublicHostLookup = async (hostname) => {
  return dnsLookup(hostname, { all: true, verbatim: true });
};

export const RESOURCE_GUIDE_ENRICHMENT_PROPERTIES = {
  ...RESOURCE_GUIDE_PROPERTIES,
  state: "Enrichment State",
  error: "Enrichment Error",
  privateNotes: "Private Research Notes",
  featured: "Featured",
} as const;

type ResourceGuidePage = {
  id: string;
  properties: Record<string, unknown>;
  parent?: { type?: string; id?: string; data_source_id?: string };
};

type DataSource = { id?: string; properties?: Record<string, unknown>; data_sources?: Array<{ id?: string }> };

export type ResourceGuideTaxonomy = {
  categories: string[];
  resourceTypes: string[];
  disciplines: string[];
  researchStages: string[];
  aiRoles: string[];
  tags: string[];
};

export type ExtractedResourceArticle = {
  title: string;
  author: string;
  publicationDate: string;
  publisher: string;
  canonicalUrl: string;
  text: string;
};

export type GeneratedResourceMetadata = {
  title: string;
  source: string;
  creator: string;
  publicationDate: string;
  category: string;
  resourceType: string;
  disciplines: string[];
  researchStages: string[];
  aiRoles: string[];
  tags: string[];
  description: string;
};

export type ResourceGuideAction = "enrichment" | "cacheInvalidated" | "failed";

export class ResourceGuideEnrichmentError extends Error {
  readonly status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "ResourceGuideEnrichmentError";
    this.status = status;
  }
}

const activePageIds = new Set<string>();

/** Validates the entered URL and every DNS result before direct retrieval. */
export async function validatePublicHttpUrl(
  value: string,
  lookup: PublicHostLookup = publicHostLookup,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ResourceGuideEnrichmentError("Enter a valid public HTTP(S) URL.");
  }
  if (!isSafeHttpUrl(url)) {
    throw new ResourceGuideEnrichmentError("Use a public HTTP(S) URL without credentials or a local address.");
  }

  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (isUnsafeHostname(hostname)) {
    throw new ResourceGuideEnrichmentError("Local, private, and reserved addresses cannot be enriched.");
  }
  if (isIpAddress(hostname)) {
    if (isUnsafeIpAddress(hostname)) {
      throw new ResourceGuideEnrichmentError("Local, private, and reserved addresses cannot be enriched.");
    }
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new ResourceGuideEnrichmentError("The source hostname could not be resolved. Check the URL and try again.");
  }
  if (!addresses.length || addresses.some(({ address }) => isUnsafeIpAddress(address))) {
    throw new ResourceGuideEnrichmentError("The source must resolve only to public internet addresses.");
  }
  return url;
}

/** Retrieves at most one small HTML document, following only validated redirects. */
export async function fetchPublicHtml(
  sourceUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    lookup?: PublicHostLookup;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
): Promise<{ finalUrl: string; html: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookup = options.lookup ?? publicHostLookup;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_HTML_BYTES;
  let current = await validatePublicHttpUrl(sourceUrl, lookup);

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9" },
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "The source took too long to respond. Try another accessible page."
        : "The source could not be retrieved. Check that the page is publicly accessible.";
      throw new ResourceGuideEnrichmentError(message, 422);
    } finally {
      clearTimeout(timer);
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new ResourceGuideEnrichmentError("The source returned an unsafe redirect.");
      if (redirects === MAX_REDIRECTS) throw new ResourceGuideEnrichmentError("The source redirected too many times.");
      current = await validatePublicHttpUrl(new URL(location, current).href, lookup);
      continue;
    }
    if (!response.ok) {
      throw new ResourceGuideEnrichmentError(`The source returned HTTP ${response.status}. Use an accessible article page.`);
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml")) {
      throw new ResourceGuideEnrichmentError("The source is not an HTML page. Use the original article URL.");
    }
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new ResourceGuideEnrichmentError("The source page is too large to process. Use a simpler article URL.");
    }
    return { finalUrl: current.href, html: await readLimitedResponse(response, maxBytes) };
  }

  throw new ResourceGuideEnrichmentError("The source redirected too many times.");
}

export function extractResourceArticle(html: string, pageUrl: string): ExtractedResourceArticle {
  const jsonLd = collectJsonLd(html);
  const og = openGraph(html);
  const title = cleanText(og["og:title"] || metaContent(html, "name", "twitter:title") || titleContent(html) || jsonLd.title);
  const author = cleanText(og["article:author"] || metaContent(html, "name", "author") || jsonLd.author);
  const publicationDate = normalizeDate(og["article:published_time"] || metaContent(html, "name", "date") || jsonLd.publicationDate);
  const publisher = cleanText(og["og:site_name"] || jsonLd.publisher || new URL(pageUrl).hostname.replace(/^www\./, ""));
  const canonicalUrl = canonicalLink(html, pageUrl);
  const text = readableText(html);
  if (!title || wordCount(text) < MIN_ARTICLE_WORDS) {
    throw new ResourceGuideEnrichmentError("No readable article text was available. The page may be blocked, paywalled, or JavaScript-only.");
  }
  return { title, author, publicationDate, publisher, canonicalUrl, text };
}

export function normalizeGeneratedResourceMetadata(
  value: unknown,
  taxonomy: ResourceGuideTaxonomy,
  fallback: Pick<ExtractedResourceArticle, "title" | "author" | "publicationDate" | "publisher">,
): GeneratedResourceMetadata {
  const record = asRecord(value) || {};
  const title = shortText(record.title, 500) || fallback.title;
  const category = matchTaxonomy(record.category, taxonomy.categories);
  if (!title || !category) {
    throw new ResourceGuideEnrichmentError("OpenAI did not return a category allowed by the current Resource Guide schema.", 502);
  }
  return {
    title,
    source: shortText(record.source, 1_800) || fallback.publisher,
    creator: shortText(record.creator, 1_800) || fallback.author,
    publicationDate: normalizeDate(stringValue(record.publicationDate)) || fallback.publicationDate,
    category,
    resourceType: matchTaxonomy(record.resourceType, taxonomy.resourceTypes),
    disciplines: matchTaxonomyList(record.disciplines, taxonomy.disciplines),
    researchStages: matchTaxonomyList(record.researchStages, taxonomy.researchStages),
    aiRoles: matchTaxonomyList(record.aiRoles, taxonomy.aiRoles),
    tags: normalizeTags(record.tags),
    description: shortText(record.description, 1_800),
  };
}

export function normalizeTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\n]/) : [];
  const seen = new Set<string>();
  return values.map((item) => titleCaseTag(stringValue(item))).filter((tag) => {
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

export async function processResourceGuidePagePropertyUpdate(
  pageId: string,
  updatedPropertyIds: readonly string[],
  store?: Pick<ResourceGuideStore, "delete">,
): Promise<{ actions: ResourceGuideAction[] }> {
  const page = await getResourceGuidePage(pageId);
  const { id: dataSourceId, schema } = await getResourceGuideSchema();
  if (!isResourceGuidePage(page, dataSourceId)) return { actions: [] };

  const actions: ResourceGuideAction[] = [];
  if (getSelectValue(page, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.state) === "Queued") {
    const result = await enrichResourceGuidePage(page, schema);
    actions.push(result);
    if (result === "enrichment" && isPublished(page)) {
      await invalidateManifest(store, actions);
    }
    return { actions };
  }

  if (shouldInvalidateForPropertyUpdate(page, updatedPropertyIds)) {
    await invalidateManifest(store, actions);
  }
  return { actions };
}

async function enrichResourceGuidePage(page: ResourceGuidePage, taxonomy: ResourceGuideTaxonomy): Promise<"enrichment" | "failed"> {
  if (activePageIds.has(page.id) || getSelectValue(page, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.state) === "Processing") {
    return "enrichment";
  }
  activePageIds.add(page.id);
  try {
    await updateResourceGuidePage(page.id, stateProperties("Processing", ""));
    const sourceUrl = getUrlValue(page, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.url);
    if (!sourceUrl) throw new ResourceGuideEnrichmentError("Add a public article URL, then click Enrich Resource again.");

    const source = await fetchPublicHtml(sourceUrl);
    const article = extractResourceArticle(source.html, source.finalUrl);
    const generated = await generateResourceMetadata(article, taxonomy);
    const metadata = normalizeGeneratedResourceMetadata(generated, taxonomy, article);
    await updateResourceGuidePage(page.id, { ...metadataProperties(metadata), ...stateProperties("Ready", "") });
    console.info("Resource Guide enrichment completed", { pageId: page.id });
    return "enrichment";
  } catch (error) {
    const message = recoveryError(error);
    console.error("Resource Guide enrichment failed", { pageId: page.id, message });
    await updateResourceGuidePage(page.id, stateProperties("Failed", message)).catch((updateError) => {
      console.error("Unable to record Resource Guide enrichment failure", { pageId: page.id, updateError });
    });
    return "failed";
  } finally {
    activePageIds.delete(page.id);
  }
}

async function generateResourceMetadata(article: ExtractedResourceArticle, taxonomy: ResourceGuideTaxonomy): Promise<unknown> {
  if (!taxonomy.categories.length) {
    throw new ResourceGuideEnrichmentError("Add at least one Resource Category option in Notion, then click Enrich Resource again.");
  }
  const constrainedList = (options: string[]) => ({
    type: "array",
    items: options.length ? { type: "string", enum: options } : { type: "string", maxLength: 0 },
  });
  const response = await openAiFetch("/responses", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.RESOURCE_GUIDE_TEXT_MODEL || process.env.CMS_TEXT_MODEL || DEFAULT_TEXT_MODEL,
      input: buildResourceMetadataPrompt(article, taxonomy),
      text: {
        format: {
          type: "json_schema",
          name: "resource_guide_metadata",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title", "source", "creator", "publicationDate", "category", "resourceType", "disciplines", "researchStages", "aiRoles", "tags", "description"],
            properties: {
              title: { type: "string" }, source: { type: "string" }, creator: { type: "string" }, publicationDate: { type: "string" },
              category: { type: "string", enum: taxonomy.categories },
              resourceType: { type: "string", enum: ["", ...taxonomy.resourceTypes] },
              disciplines: constrainedList(taxonomy.disciplines),
              researchStages: constrainedList(taxonomy.researchStages),
              aiRoles: constrainedList(taxonomy.aiRoles),
              tags: { type: "array", items: { type: "string" } }, description: { type: "string" },
            },
          },
        },
      },
    }),
  });
  const output = await response.json() as Record<string, unknown>;
  try {
    return JSON.parse(extractOpenAiOutputText(output));
  } catch {
    throw new ResourceGuideEnrichmentError("OpenAI returned invalid Resource Guide metadata. Click Enrich Resource to try again.", 502);
  }
}

export function buildResourceMetadataPrompt(article: ExtractedResourceArticle, taxonomy: ResourceGuideTaxonomy): string {
  return [
    "Create concise, factual metadata for one AI-and-research Resource Guide entry.",
    "Use only the supplied article text and source metadata. Do not browse, invent facts, or write Public Annotation or private notes.",
    "Return the requested JSON. Empty strings/arrays are allowed for optional fields. Keep descriptions to two plain-text sentences or fewer.",
    `Allowed Resource Category values (choose exactly one): ${taxonomy.categories.join(", ")}.`,
    `Allowed Resource Type values: ${taxonomy.resourceTypes.join(", ") || "none"}.`,
    `Allowed Discipline values: ${taxonomy.disciplines.join(", ") || "none"}.`,
    `Allowed Research-process Stage values: ${taxonomy.researchStages.join(", ") || "none"}.`,
    `Allowed AI Role / Intervention values: ${taxonomy.aiRoles.join(", ") || "none"}.`,
    `Source title: ${article.title}`,
    `Source author: ${article.author || "unknown"}`,
    `Source publisher: ${article.publisher || "unknown"}`,
    `Source publication date: ${article.publicationDate || "unknown"}`,
    "Article text:",
    article.text.slice(0, 30_000),
  ].join("\n\n");
}

function metadataProperties(metadata: GeneratedResourceMetadata): Record<string, unknown> {
  return {
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.title]: titleProperty(metadata.title),
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.source]: richTextProperty(metadata.source),
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.creator]: richTextProperty(metadata.creator),
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.publicationDate]: { date: metadata.publicationDate ? { start: metadata.publicationDate } : null },
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.category]: { select: { name: metadata.category } },
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.resourceType]: { select: metadata.resourceType ? { name: metadata.resourceType } : null },
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.disciplines]: { multi_select: metadata.disciplines.map((name) => ({ name })) },
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.researchStages]: { multi_select: metadata.researchStages.map((name) => ({ name })) },
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.aiRoles]: { multi_select: metadata.aiRoles.map((name) => ({ name })) },
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.tags]: { multi_select: metadata.tags.map((name) => ({ name })) },
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.description]: richTextProperty(metadata.description),
  };
}

function stateProperties(state: "Processing" | "Ready" | "Failed", error: string): Record<string, unknown> {
  return {
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.state]: { select: { name: state } },
    [RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.error]: richTextProperty(error.slice(0, 500)),
  };
}

async function getResourceGuidePage(pageId: string): Promise<ResourceGuidePage> {
  return (await notionFetch(`/pages/${pageId}`)).json() as Promise<ResourceGuidePage>;
}

async function getResourceGuideSchema(): Promise<{ id: string; schema: ResourceGuideTaxonomy }> {
  const configured = String(process.env.NOTION_RESOURCES_DATABASE_ID || "").replace(/^collection:\/\//, "").trim();
  if (!configured) throw new ResourceGuideEnrichmentError("NOTION_RESOURCES_DATABASE_ID is not configured.", 500);
  let source: DataSource;
  try {
    source = await (await notionFetch(`/data_sources/${configured}`)).json() as DataSource;
  } catch {
    const database = await (await notionFetch(`/databases/${configured}`)).json() as DataSource;
    const id = database.data_sources?.[0]?.id;
    if (!id) throw new ResourceGuideEnrichmentError("The configured Resource Guide database has no data source.", 500);
    source = await (await notionFetch(`/data_sources/${id}`)).json() as DataSource;
  }
  if (!source.id || !source.properties) throw new ResourceGuideEnrichmentError("Resource Guide schema is unavailable.", 502);
  return { id: source.id, schema: taxonomyFromDataSource(source) };
}

function taxonomyFromDataSource(source: DataSource): ResourceGuideTaxonomy {
  return {
    categories: propertyOptions(source, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.category, "select"),
    resourceTypes: propertyOptions(source, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.resourceType, "select"),
    disciplines: propertyOptions(source, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.disciplines, "multi_select"),
    researchStages: propertyOptions(source, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.researchStages, "multi_select"),
    aiRoles: propertyOptions(source, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.aiRoles, "multi_select"),
    tags: propertyOptions(source, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.tags, "multi_select"),
  };
}

function propertyOptions(source: DataSource, propertyName: string, type: "select" | "multi_select"): string[] {
  const property = asRecord(source.properties?.[propertyName]);
  const options = asRecord(property?.[type])?.options;
  return Array.isArray(options) ? options.map((option) => stringValue(asRecord(option)?.name)).filter(Boolean) : [];
}

function isResourceGuidePage(page: ResourceGuidePage, dataSourceId: string): boolean {
  return page.parent?.data_source_id === dataSourceId
    || (page.parent?.type === "data_source_id" && page.parent.id === dataSourceId);
}

function shouldInvalidateForPropertyUpdate(page: ResourceGuidePage, updatedPropertyIds: readonly string[]): boolean {
  if (updatedPropertyIds.length === 0) return true;
  const propertyIds = new Map(Object.entries(page.properties).map(([name, property]) => [name, stringValue(asRecord(property)?.id)]));
  const changed = (name: string) => {
    const id = propertyIds.get(name);
    return Boolean(id && updatedPropertyIds.includes(id));
  };
  if (changed(RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.publicationStatus)) return true;
  if (!isPublished(page)) return false;
  return [
    RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.title, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.url,
    RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.category, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.resourceType,
    RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.source, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.creator,
    RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.publicationDate, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.disciplines,
    RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.researchStages, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.aiRoles,
    RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.tags, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.description,
    RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.publicAnnotation,
  ].some(changed);
}

async function invalidateManifest(store: Pick<ResourceGuideStore, "delete"> | undefined, actions: ResourceGuideAction[]): Promise<void> {
  if (!store) return;
  await invalidateResourceGuideManifest(store);
  actions.push("cacheInvalidated");
}

async function updateResourceGuidePage(pageId: string, properties: Record<string, unknown>): Promise<void> {
  await notionFetch(`/pages/${pageId}`, { method: "PATCH", body: JSON.stringify({ properties }) });
}

async function notionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!process.env.NOTION_API_KEY) throw new ResourceGuideEnrichmentError("NOTION_API_KEY is not configured.", 500);
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.NOTION_API_KEY}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new ResourceGuideEnrichmentError(`Notion API request failed (${response.status}).`, 502);
  return response;
}

async function openAiFetch(path: string, init: RequestInit): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) throw new ResourceGuideEnrichmentError("OPENAI_API_KEY is not configured.", 500);
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) throw new ResourceGuideEnrichmentError(`OpenAI metadata generation failed (${response.status}). Try again shortly.`, 502);
  return response;
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new ResourceGuideEnrichmentError("The source returned no readable HTML.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ResourceGuideEnrichmentError("The source page is too large to process. Use a simpler article URL.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function isSafeHttpUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && Boolean(url.hostname);
}

function isUnsafeHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")
    || hostname.endsWith(".test") || hostname.endsWith(".example") || hostname.endsWith(".invalid");
}

function isIpAddress(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(":");
}

function isUnsafeIpAddress(value: string): boolean {
  if (value.includes(":")) {
    const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
    return normalized === "::1" || normalized === "::" || normalized.startsWith("::ffff:")
      || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8")
      || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")
      || normalized.startsWith("ff") || normalized.startsWith("2001:db8:") || normalized.startsWith("2001:10:")
      || normalized.startsWith("2001:2:");
  }
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0)
    || (a === 192 && b === 168) || (a === 192 && b === 88) || (a === 192 && b === 0 && parts[2] === 2)
    || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && (b === 0 || b === 113));
}

function isRedirect(status: number): boolean { return [301, 302, 303, 307, 308].includes(status); }

function openGraph(html: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = htmlAttributes(tag);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key.startsWith("og:") || key === "article:author" || key === "article:published_time") values[key] = attrs.content || "";
  }
  return values;
}

function metaContent(html: string, attribute: "name" | "property", value: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = htmlAttributes(tag);
    if ((attrs[attribute] || "").toLowerCase() === value.toLowerCase()) return attrs.content || "";
  }
  return "";
}

function htmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[match[1]!.toLowerCase()] = match[2] || match[3] || match[4] || "";
  }
  return attrs;
}

function titleContent(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToText(match[1]) : "";
}

function canonicalLink(html: string, pageUrl: string): string {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = htmlAttributes(tag);
    if ((attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical") && attrs.href) {
      try { return new URL(attrs.href, pageUrl).href; } catch { return pageUrl; }
    }
  }
  return pageUrl;
}

function collectJsonLd(html: string): { title: string; author: string; publicationDate: string; publisher: string } {
  const result = { title: "", author: "", publicationDate: "", publisher: "" };
  for (const script of html.match(/<script\b[^>]*type=["']application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || []) {
    const match = script.match(/>([\s\S]*?)<\/script>/i);
    if (!match) continue;
    try {
      for (const item of flattenJsonLd(JSON.parse(match[1]))) {
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (!types.some((type) => /article|report|news/i.test(String(type)))) continue;
        result.title ||= stringValue(item.headline) || stringValue(item.name);
        result.author ||= personName(item.author);
        result.publicationDate ||= stringValue(item.datePublished);
        result.publisher ||= personName(item.publisher);
      }
    } catch { /* Ignore malformed publisher JSON-LD. */ }
  }
  return result;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  const record = asRecord(value);
  if (!record) return [];
  return [record, ...flattenJsonLd(record["@graph"])];
}

function personName(value: unknown): string {
  if (Array.isArray(value)) return personName(value[0]);
  return stringValue(value) || stringValue(asRecord(value)?.name);
}

function readableText(html: string): string {
  const preferred = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || html.match(/<[^>]+itemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1]
    || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    || "";
  return htmlToText(preferred
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " "));
}

function htmlToText(value: string): string {
  return decodeHtml(value.replace(/<(br|p|div|li|h[1-6]|blockquote|section)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&"; if (lower === "quot") return "\""; if (lower === "apos") return "'";
    if (lower === "lt") return "<"; if (lower === "gt") return ">"; if (lower === "nbsp") return " ";
    const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
  });
}

function getSelectValue(page: ResourceGuidePage, propertyName: string): string {
  return stringValue(asRecord(asRecord(page.properties[propertyName])?.select)?.name);
}

function getUrlValue(page: ResourceGuidePage, propertyName: string): string {
  return stringValue(asRecord(page.properties[propertyName])?.url);
}

function isPublished(page: ResourceGuidePage): boolean {
  return getSelectValue(page, RESOURCE_GUIDE_ENRICHMENT_PROPERTIES.publicationStatus) === "Published";
}

function richTextProperty(content: string): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return { rich_text: content ? [{ type: "text", text: { content } }] : [] };
}

function titleProperty(content: string): { title: Array<{ type: "text"; text: { content: string } }> } {
  return { title: [{ type: "text", text: { content } }] };
}

function extractOpenAiOutputText(output: Record<string, unknown>): string {
  if (typeof output.output_text === "string") return output.output_text;
  for (const entry of Array.isArray(output.output) ? output.output : []) {
    const content = asRecord(entry)?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      const text = asRecord(item)?.text;
      if (typeof text === "string") return text;
    }
  }
  throw new ResourceGuideEnrichmentError("OpenAI returned no Resource Guide metadata. Click Enrich Resource to try again.", 502);
}

function matchTaxonomy(value: unknown, options: string[]): string {
  const normalized = stringValue(value).toLocaleLowerCase();
  return options.find((option) => option.toLocaleLowerCase() === normalized) || "";
}

function matchTaxonomyList(value: unknown, options: string[]): string[] {
  const values = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return values.map((item) => matchTaxonomy(item, options)).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleCaseTag(value: string): string {
  const acronyms = new Set(["ai", "llm", "llms", "un", "api", "apis", "uk", "us", "eu", "nasa"]);
  return value.replace(/\s+/g, " ").trim().slice(0, 100).split(" ").map((word) => {
    const lower = word.toLocaleLowerCase();
    if (acronyms.has(lower)) return lower.toUpperCase();
    return lower.replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase());
  }).join(" ");
}

function normalizeDate(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match || !Number.isFinite(Date.parse(match[1]!))) return "";
  return match[1]!;
}

function shortText(value: unknown, max: number): string { return cleanText(stringValue(value)).slice(0, max); }
function cleanText(value: string): string { return decodeHtml(value).replace(/\s+/g, " ").trim(); }
function wordCount(value: string): number { return value ? value.split(/\s+/).length : 0; }
function stringValue(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function recoveryError(error: unknown): string { return error instanceof Error ? cleanText(error.message).slice(0, 500) : "Enrichment failed. Check the source URL and try again."; }

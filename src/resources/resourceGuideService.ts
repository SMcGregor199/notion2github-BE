import { createHash } from "node:crypto";
import type {
  ResourceGuideLoadResult,
  ResourceGuideManifest,
  ResourceGuideNotionClient,
  ResourceGuideResource,
  ResourceGuideResponse,
  ResourceGuideStore,
} from "./types.js";

export const RESOURCE_GUIDE_MANIFEST_KEY = "guide/manifest.json";
export const RESOURCE_GUIDE_CONTENT_PREFIX = "guide/content/";
export const DEFAULT_RESOURCE_GUIDE_CACHE_TTL_MS = 60 * 60 * 1000;

export const RESOURCE_GUIDE_PROPERTIES = {
  title: "Name",
  url: "URL",
  publicationStatus: "Publication Status",
  category: "Resource Category",
  resourceType: "Resource Type",
  source: "Publication / Organization",
  creator: "Author / Creator",
  publicationDate: "Publication Date",
  disciplines: "Discipline",
  researchStages: "Research-process Stage",
  aiRoles: "AI Role / Intervention",
  tags: "Tags",
  description: "Short Description",
  publicAnnotation: "Public Annotation",
  sortPriority: "Sort Priority",
} as const;

type ResourceGuideLoadOptions = {
  store: ResourceGuideStore;
  notion: ResourceGuideNotionClient;
  databaseId: string;
  now?: Date;
  cacheTtlMs?: number;
};

type NormalizedResource = {
  resource: ResourceGuideResource;
  sortPriority: number | null;
};

export class ResourceGuideUnavailableError extends Error {}

export async function loadResourceGuide(options: ResourceGuideLoadOptions): Promise<ResourceGuideLoadResult> {
  const now = options.now ?? new Date();
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_RESOURCE_GUIDE_CACHE_TTL_MS;
  const cached = await readCachedGuide(options.store);

  if (cached && isFresh(cached.manifest.fetchedAt, now, cacheTtlMs)) {
    return { response: cached.response, etag: cached.etag, stale: false };
  }

  try {
    const pages = await queryPublishedResourcePages(options.notion, options.databaseId);
    const resources = pages
      .map(normalizeResourcePage)
      .filter((value): value is NormalizedResource => value !== null)
      .sort(compareResources)
      .map(({ resource }) => resource);
    const etag = createHash("sha256").update(JSON.stringify(resources)).digest("hex");
    const response: ResourceGuideResponse = { resources, generatedAt: now.toISOString() };
    const contentKey = `${RESOURCE_GUIDE_CONTENT_PREFIX}${etag}.json`;

    await options.store.set(contentKey, JSON.stringify(response));
    await options.store.setJSON(RESOURCE_GUIDE_MANIFEST_KEY, {
      currentKey: contentKey,
      fetchedAt: now.toISOString(),
    } satisfies ResourceGuideManifest);

    return { response, etag, stale: false };
  } catch (error) {
    if (cached) {
      return { response: cached.response, etag: cached.etag, stale: true };
    }
    throw new ResourceGuideUnavailableError("Resource Guide data is temporarily unavailable.", { cause: error });
  }
}

export async function queryPublishedResourcePages(
  notion: ResourceGuideNotionClient,
  databaseOrDataSourceId: string,
): Promise<unknown[]> {
  const dataSourceId = await resolveDataSourceId(notion, databaseOrDataSourceId);
  const pages: unknown[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      filter: {
        property: RESOURCE_GUIDE_PROPERTIES.publicationStatus,
        select: { equals: "Published" },
      },
    });
    pages.push(...response.results);
    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

export function normalizeResourcePage(page: unknown): NormalizedResource | null {
  const record = asRecord(page);
  const properties = asRecord(record?.properties);
  const id = stringValue(record?.id);
  const title = richText(properties?.[RESOURCE_GUIDE_PROPERTIES.title], "title");
  const url = safeHttpUrl(urlProperty(properties?.[RESOURCE_GUIDE_PROPERTIES.url]));
  const dateAdded = validDate(stringValue(record?.created_time));

  if (!id || !title || !url || !dateAdded || !isPublished(properties?.[RESOURCE_GUIDE_PROPERTIES.publicationStatus])) {
    return null;
  }

  const resource: ResourceGuideResource = {
    id,
    title,
    url,
    category: selectName(properties?.[RESOURCE_GUIDE_PROPERTIES.category]) || "Uncategorized",
    dateAdded,
    disciplines: multiSelectNames(properties?.[RESOURCE_GUIDE_PROPERTIES.disciplines]),
    researchStages: multiSelectNames(properties?.[RESOURCE_GUIDE_PROPERTIES.researchStages]),
    aiRoles: multiSelectNames(properties?.[RESOURCE_GUIDE_PROPERTIES.aiRoles]),
    tags: multiSelectNames(properties?.[RESOURCE_GUIDE_PROPERTIES.tags]),
    ...optional("resourceType", selectName(properties?.[RESOURCE_GUIDE_PROPERTIES.resourceType])),
    ...optional("source", richText(properties?.[RESOURCE_GUIDE_PROPERTIES.source], "rich_text")),
    ...optional("creator", richText(properties?.[RESOURCE_GUIDE_PROPERTIES.creator], "rich_text")),
    ...optional("publishedDate", validDate(dateProperty(properties?.[RESOURCE_GUIDE_PROPERTIES.publicationDate]))),
    ...optional("description", richText(properties?.[RESOURCE_GUIDE_PROPERTIES.description], "rich_text")),
    ...optional("publicAnnotation", richText(properties?.[RESOURCE_GUIDE_PROPERTIES.publicAnnotation], "rich_text")),
  };

  return { resource, sortPriority: numberProperty(properties?.[RESOURCE_GUIDE_PROPERTIES.sortPriority]) };
}

/**
 * Removes only the Resource Guide freshness pointer.  Content snapshots are
 * immutable and may remain in the store; the next guide request rebuilds the
 * manifest from Notion instead of waiting for the normal TTL.
 */
export async function invalidateResourceGuideManifest(store: Pick<ResourceGuideStore, "delete">): Promise<void> {
  await store.delete(RESOURCE_GUIDE_MANIFEST_KEY);
}

async function resolveDataSourceId(notion: ResourceGuideNotionClient, databaseOrDataSourceId: string): Promise<string> {
  const normalizedId = databaseOrDataSourceId.replace(/^collection:\/\//, "").trim();
  try {
    const database = asRecord(await notion.databases.retrieve({ database_id: normalizedId }));
    const dataSources = Array.isArray(database?.data_sources) ? database.data_sources : [];
    const first = asRecord(dataSources[0]);
    return stringValue(first?.id) || normalizedId;
  } catch {
    return normalizedId;
  }
}

async function readCachedGuide(store: ResourceGuideStore): Promise<{
  manifest: ResourceGuideManifest;
  response: ResourceGuideResponse;
  etag: string;
} | null> {
  const manifest = asManifest(await store.get(RESOURCE_GUIDE_MANIFEST_KEY, { type: "json" }));
  if (!manifest) return null;
  const response = asResponse(await store.get(manifest.currentKey, { type: "json" }));
  if (!response) return null;
  const etag = manifest.currentKey.replace(`${RESOURCE_GUIDE_CONTENT_PREFIX}`, "").replace(/\.json$/, "");
  return etag ? { manifest, response, etag } : null;
}

function asManifest(value: unknown): ResourceGuideManifest | null {
  const record = asRecord(value);
  const currentKey = stringValue(record?.currentKey);
  const fetchedAt = validDate(stringValue(record?.fetchedAt));
  return currentKey && fetchedAt ? { currentKey, fetchedAt } : null;
}

function asResponse(value: unknown): ResourceGuideResponse | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.resources) || !validDate(stringValue(record.generatedAt))) return null;
  const resources = record.resources.map(normalizeResponseResource).filter((resource): resource is ResourceGuideResource => resource !== null);
  return resources.length === record.resources.length ? { resources, generatedAt: record.generatedAt as string } : null;
}

function normalizeResponseResource(value: unknown): ResourceGuideResource | null {
  const record = asRecord(value);
  const id = stringValue(record?.id);
  const title = stringValue(record?.title);
  const url = safeHttpUrl(stringValue(record?.url));
  const category = stringValue(record?.category);
  const dateAdded = validDate(stringValue(record?.dateAdded));
  if (!id || !title || !url || !category || !dateAdded) return null;
  return {
    id, title, url, category, dateAdded,
    disciplines: stringArray(record?.disciplines),
    researchStages: stringArray(record?.researchStages),
    aiRoles: stringArray(record?.aiRoles),
    tags: stringArray(record?.tags),
    ...optional("resourceType", stringValue(record?.resourceType)),
    ...optional("source", stringValue(record?.source)),
    ...optional("creator", stringValue(record?.creator)),
    ...optional("publishedDate", validDate(stringValue(record?.publishedDate))),
    ...optional("description", stringValue(record?.description)),
    ...optional("publicAnnotation", stringValue(record?.publicAnnotation)),
  };
}

function compareResources(left: NormalizedResource, right: NormalizedResource): number {
  const leftPriority = left.sortPriority ?? Number.POSITIVE_INFINITY;
  const rightPriority = right.sortPriority ?? Number.POSITIVE_INFINITY;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  const leftPublicationDate = left.resource.publishedDate ?? "";
  const rightPublicationDate = right.resource.publishedDate ?? "";
  return rightPublicationDate.localeCompare(leftPublicationDate)
    || right.resource.dateAdded.localeCompare(left.resource.dateAdded)
    || left.resource.title.localeCompare(right.resource.title);
}

function isFresh(fetchedAt: string, now: Date, cacheTtlMs: number): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  return Number.isFinite(fetchedAtMs) && fetchedAtMs + Math.max(0, cacheTtlMs) > now.getTime();
}

function isPublished(value: unknown): boolean {
  const property = asRecord(value);
  return property?.type === "select" && selectName(property) === "Published";
}

function richText(value: unknown, expectedType: "title" | "rich_text"): string {
  const property = asRecord(value);
  if (property?.type !== expectedType || !Array.isArray(property[expectedType])) return "";
  return property[expectedType]
    .map((part) => stringValue(asRecord(part)?.plain_text) || stringValue(asRecord(asRecord(part)?.text)?.content) || "")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function urlProperty(value: unknown): string {
  const property = asRecord(value);
  return property?.type === "url" ? stringValue(property.url) : "";
}

function dateProperty(value: unknown): string {
  const property = asRecord(value);
  return property?.type === "date" ? stringValue(asRecord(property.date)?.start) : "";
}

function selectName(value: unknown): string {
  const property = asRecord(value);
  return property?.type === "select" ? stringValue(asRecord(property.select)?.name) : "";
}

function multiSelectNames(value: unknown): string[] {
  const property = asRecord(value);
  if (property?.type !== "multi_select" || !Array.isArray(property.multi_select)) return [];
  return [...new Set(property.multi_select.map((item) => stringValue(asRecord(item)?.name)).filter(Boolean))];
}

function numberProperty(value: unknown): number | null {
  const property = asRecord(value);
  return property?.type === "number" && typeof property.number === "number" && Number.isFinite(property.number)
    ? property.number
    : null;
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function validDate(value: string): string {
  return value && Number.isFinite(Date.parse(value)) ? value : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(stringValue).filter(Boolean))] : [];
}

function optional<Key extends keyof Pick<ResourceGuideResource, "resourceType" | "source" | "creator" | "publishedDate" | "description" | "publicAnnotation">>(key: Key, value: string): Partial<Pick<ResourceGuideResource, Key>> {
  return value ? { [key]: value } as Partial<Pick<ResourceGuideResource, Key>> : {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

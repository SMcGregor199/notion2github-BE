import { createHash, timingSafeEqual } from "node:crypto";
import slugifyModule from "slugify";
// @ts-expect-error This established runtime utility is JavaScript-only.
import { getPageBodyMarkdown } from "../../utils/helper.js";
import { NEWSLETTER_PROPERTIES, sendNewsletterForPageId } from "../newsletter/newsletterService.js";

const NOTION_API_BASE = "https://api.notion.com/v1";
const OPENAI_API_BASE = "https://api.openai.com/v1";
const NOTION_VERSION = "2026-03-11";
const SUMMARY_MAX_LENGTH = 70;
const NEWSLETTER_INTRO_MAX_LENGTH = 600;
const BODY_MAX_LENGTH = 30_000;
const slugify = slugifyModule as unknown as (value: string, options: { lower: boolean; strict: boolean }) => string;

export const CMS_PROPERTIES = {
  title: "Name",
  published: "Published",
  tag: "Tag",
  summary: "Summary",
  slug: "Slug",
  featureImage: "Feature Image",
  publicationDate: "Publication Date",
  recordId: "CMS Record ID",
  metadataState: "Metadata State",
  metadataError: "Metadata Error",
  newsletterIntro: NEWSLETTER_PROPERTIES.intro,
  linkedinDiscussionUrl: NEWSLETTER_PROPERTIES.linkedinUrl,
  newsletterState: NEWSLETTER_PROPERTIES.state,
  newsletterSentAt: NEWSLETTER_PROPERTIES.sentAt,
  newsletterError: NEWSLETTER_PROPERTIES.error,
  newsletterBroadcastId: NEWSLETTER_PROPERTIES.broadcastId,
} as const;

type CmsWebhookAction = "metadata" | "publication" | "publicData" | "newsletterDraft" | "newsletter";

export type MetadataState = "New" | "Queued" | "Processing" | "Ready" | "Failed";

export interface GeneratedMetadata {
  summary: string;
  tag: string;
  imageBrief: string;
  newsletterIntro: string;
}

export interface CmsPage {
  id: string;
  created_time: string;
  is_locked?: boolean;
  properties: Record<string, unknown>;
  parent?: {
    type?: string;
    id?: string;
    data_source_id?: string;
  };
}

interface NotionDataSource {
  properties?: Record<string, unknown>;
}

interface PageQueryResponse {
  results?: CmsPage[];
  has_more?: boolean;
  next_cursor?: string | null;
}

export class CmsWorkflowError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "CmsWorkflowError";
    this.status = status;
  }
}

export function extractCmsRecordId(payload: unknown): number | null {
  const candidates = collectRecordIdCandidates(payload);
  for (const candidate of candidates) {
    const numberValue = parseCmsRecordId(candidate);
    if (Number.isSafeInteger(numberValue) && numberValue > 0) {
      return numberValue;
    }
  }
  return null;
}

function parseCmsRecordId(value: unknown): number {
  if (typeof value === "string") {
    const match = value.match(/(?:^|-)\d+$/);
    if (match) return Number(match[0].replace(/^-/, ""));
  }
  return Number(value);
}

export function isAuthorizedWebhook(request: Request, secret: string | undefined): boolean {
  if (!secret) {
    throw new CmsWorkflowError("CMS_WEBHOOK_SECRET is not configured.", 500);
  }

  const provided = request.headers.get("x-cms-webhook-secret") || "";
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export function normalizeSummary(value: unknown): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.slice(0, SUMMARY_MAX_LENGTH).replace(/[,:;\-\s]+$/, "");
}

export function normalizeNewsletterIntro(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, NEWSLETTER_INTRO_MAX_LENGTH);
}

export function slugForTitle(title: string): string {
  return slugify(title.trim(), { lower: true, strict: true }) || "untitled-post";
}

export function chooseUniqueSlug(baseSlug: string, existingSlugs: Iterable<string>, pageId: string): string {
  const normalized = new Set([...existingSlugs].map((value) => String(value || "").trim()).filter(Boolean));
  if (!normalized.has(baseSlug)) {
    return baseSlug;
  }

  const suffix = createHash("sha256").update(pageId).digest("hex").slice(0, 8);
  return `${baseSlug}-${suffix}`;
}

export function buildMetadataPrompt(input: { title: string; markdown: string; existingTags: string[] }): string {
  return [
    "You prepare metadata for a personal engineering and technology blog.",
    "Return JSON only with summary, tag, imageBrief, and newsletterIntro.",
    `summary must be one punchy, accurate share-preview sentence no longer than ${SUMMARY_MAX_LENGTH} characters, with no markdown or quotation marks. Lead with the clearest compelling hook, use active language and a concrete insight or benefit, and avoid clickbait.`,
    "tag must be the single best category. Prefer one of the existing tags when it fits. Create a concise new category only when none fit.",
    "imageBrief must describe a single post-specific feature image subject; do not include typography, logos, brand names, or words to render.",
    `newsletterIntro must be a warm, personal first-person opening of one or two sentences, no longer than ${NEWSLETTER_INTRO_MAX_LENGTH} characters. Explain why this post matters without restating the summary. Use plain text only: no markdown, greeting, subject line, or call to action.`,
    `Existing tags: ${input.existingTags.join(", ") || "none"}.`,
    `Title: ${input.title}`,
    "Article Markdown:",
    input.markdown.slice(0, BODY_MAX_LENGTH),
  ].join("\n\n");
}

export function buildFeatureImagePrompt(input: { title: string; summary: string; imageBrief: string }): string {
  return [
    "Create a polished 3:2 editorial feature illustration for a personal technology blog.",
    "Visual direction: spacey hip-hop and cyberpunk editorial art; anime-influenced but original character and object design; electric magenta, cyan, deep blue, and violet lighting; cosmic environments; lo-fi texture; confident cinematic composition.",
    "Make the image specifically communicate the article subject. Use one clear focal scene, not a generic neon wallpaper.",
    "Compose for article, featured-card, thumbnail, and social-share crops: keep every essential subject, face, device, and story detail entirely inside the centered square safe area (the central two-thirds of the canvas width). Reserve the outer left and right edges for nonessential atmospheric context only.",
    "Do not render words, letters, logos, UI copy, watermarks, or recognizable copyrighted characters.",
    `Article title: ${input.title}`,
    `Article summary: ${input.summary}`,
    `Subject brief: ${input.imageBrief}`,
  ].join("\n\n");
}

export async function initializeCmsMetadata(recordId: number): Promise<{ pageId: string; skipped: boolean }> {
  const page = await findCmsPage(recordId);
  return initializeCmsMetadataForPage(page);
}

export async function initializeCmsMetadataForPageId(pageId: string): Promise<{ pageId: string; skipped: boolean }> {
  const page = await getCmsPage(pageId);
  if (!(await isCmsPage(page))) {
    throw new CmsWorkflowError("Page is not in the configured CMS data source.", 404);
  }
  return initializeCmsMetadataForPage(page);
}

async function initializeCmsMetadataForPage(page: CmsPage): Promise<{ pageId: string; skipped: boolean }> {
  const state = getSelectValue(page, CMS_PROPERTIES.metadataState);
  if (state === "Processing") {
    throw new CmsWorkflowError("This post is already being prepared.", 409);
  }

  await updateCmsPage(page.id, metadataStateProperties("Processing", ""));
  console.info("CMS metadata generation started", { pageId: page.id });

  try {
    const title = getTitleValue(page, CMS_PROPERTIES.title);
    if (!title) {
      throw new CmsWorkflowError("The post needs a title before metadata can be generated.", 422);
    }

    const [dataSource, markdown, existingSlugs] = await Promise.all([
      getCmsDataSource(),
      getPageBodyMarkdown(page.id),
      getExistingSlugs(page.id),
    ]);
    if (!markdown.trim()) {
      throw new CmsWorkflowError("The post needs article content before metadata can be generated.", 422);
    }

    const existingTags = getSelectOptions(dataSource, CMS_PROPERTIES.tag);
    const metadata = await generateMetadata(title, markdown, existingTags);
    console.info("CMS metadata text generated", { pageId: page.id });
    const summary = normalizeSummary(metadata.summary);
    const tag = normalizeTag(metadata.tag);
    const newsletterIntro = normalizeNewsletterIntro(metadata.newsletterIntro);
    if (!summary || !tag || !metadata.imageBrief.trim() || !newsletterIntro) {
      throw new CmsWorkflowError("OpenAI returned incomplete blog metadata.", 502);
    }

    const slug = chooseUniqueSlug(slugForTitle(title), existingSlugs, page.id);
    const imageBytes = await generateFeatureImage(buildFeatureImagePrompt({
      title,
      summary,
      imageBrief: metadata.imageBrief,
    }));
    console.info("CMS feature image generated", { pageId: page.id, bytes: imageBytes.byteLength });
    const fileUploadId = await uploadImageToNotion(imageBytes, `${slug}.webp`);
    console.info("CMS feature image uploaded to Notion", { pageId: page.id, fileUploadId });

    await updateCmsPage(page.id, {
      [CMS_PROPERTIES.summary]: richTextProperty(summary),
      [CMS_PROPERTIES.tag]: { select: { name: tag } },
      [CMS_PROPERTIES.slug]: richTextProperty(slug),
      [CMS_PROPERTIES.newsletterIntro]: richTextProperty(newsletterIntro),
      [CMS_PROPERTIES.featureImage]: {
        files: [{ type: "file_upload", name: `${slug}.webp`, file_upload: { id: fileUploadId } }],
      },
      ...(getSelectValue(page, CMS_PROPERTIES.newsletterState)
        ? {}
        : { [CMS_PROPERTIES.newsletterState]: { select: { name: "Draft" } } }),
      ...metadataStateProperties("Ready", ""),
    });
    console.info("CMS metadata generation completed", { pageId: page.id });

    return { pageId: page.id, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CMS metadata error.";
    console.error("CMS metadata generation failed", { pageId: page.id, message });
    await updateCmsPage(page.id, metadataStateProperties("Failed", message)).catch((updateError) => {
      console.error("Unable to record CMS metadata failure:", updateError);
    });
    throw error;
  }
}

export async function syncCmsPublication(recordId: number): Promise<{ pageId: string; published: boolean; publicationDateSet: boolean; lockStateChanged: boolean }> {
  const page = await findCmsPage(recordId);
  return syncCmsPublicationForPage(page);
}

export async function processCmsPagePropertyUpdate(
  pageId: string,
  updatedPropertyIds: readonly string[],
): Promise<{ actions: CmsWebhookAction[] }> {
  const page = await getCmsPage(pageId);
  if (!(await isCmsPage(page))) {
    return { actions: [] };
  }

  const changed = new Set(updatedPropertyIds);
  const actions: CmsWebhookAction[] = [];
  if (
    changed.has(getPropertyId(page, CMS_PROPERTIES.metadataState))
    && getSelectValue(page, CMS_PROPERTIES.metadataState) === "Queued"
  ) {
    await initializeCmsMetadataForPage(page);
    actions.push("metadata");
  }

  const publicationChanged = changed.has(getPropertyId(page, CMS_PROPERTIES.published));
  const publicationLockOutOfSync = typeof page.is_locked === "boolean"
    && page.is_locked !== getCheckboxValue(page, CMS_PROPERTIES.published);
  if (publicationChanged || publicationLockOutOfSync) {
    await syncCmsPublicationForPage(page);
    await refreshPublishedBlogData();
    actions.push("publication");
  }

  if (
    changed.has(getPropertyId(page, CMS_PROPERTIES.linkedinDiscussionUrl))
    && !publicationChanged
    && getCheckboxValue(page, CMS_PROPERTIES.published)
  ) {
    await refreshPublishedBlogData();
    actions.push("publicData");
  }

  if (await syncNewsletterDraftState(page)) {
    actions.push("newsletterDraft");
  }

  if (
    changed.has(getPropertyId(page, CMS_PROPERTIES.newsletterState))
    && getSelectValue(page, CMS_PROPERTIES.newsletterState) === "Queued"
  ) {
    await sendNewsletterForPageId(page.id);
    actions.push("newsletter");
  }

  return { actions };
}

export async function processCmsPageUnlocked(
  pageId: string,
): Promise<{ actions: CmsWebhookAction[] }> {
  const page = await getCmsPage(pageId);
  if (!(await isCmsPage(page)) || !getCheckboxValue(page, CMS_PROPERTIES.published)) {
    return { actions: [] };
  }

  await updateCmsPage(page.id, {
    [CMS_PROPERTIES.published]: { checkbox: false },
  }, false);
  await refreshPublishedBlogData();
  return { actions: ["publication"] };
}

export async function reconcileCmsPageLocks(): Promise<{
  inspected: number;
  locked: number;
  unlocked: number;
  unchanged: number;
}> {
  const dataSourceId = await resolveDataSourceId();
  const result = { inspected: 0, locked: 0, unlocked: 0, unchanged: 0 };
  let cursor: string | null | undefined;

  do {
    const response = await notionFetch(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    const pageResult = await response.json() as PageQueryResponse;
    for (const page of pageResult.results || []) {
      result.inspected += 1;
      const shouldBeLocked = getCheckboxValue(page, CMS_PROPERTIES.published);
      if (page.is_locked === shouldBeLocked) {
        result.unchanged += 1;
        continue;
      }

      await updateCmsPage(page.id, {}, shouldBeLocked);
      if (shouldBeLocked) result.locked += 1;
      else result.unlocked += 1;
    }
    cursor = pageResult.has_more ? pageResult.next_cursor : undefined;
  } while (cursor);

  return result;
}

async function syncCmsPublicationForPage(page: CmsPage): Promise<{ pageId: string; published: boolean; publicationDateSet: boolean; lockStateChanged: boolean }> {
  const published = getCheckboxValue(page, CMS_PROPERTIES.published);
  const publicationDate = getDateValue(page, CMS_PROPERTIES.publicationDate);
  let publicationDateSet = false;

  const properties: Record<string, unknown> = {};
  if (published && !publicationDate) {
    properties[CMS_PROPERTIES.publicationDate] = { date: { start: new Date().toISOString() } };
    publicationDateSet = true;
  }
  const lockStateChanged = page.is_locked !== published;
  if (Object.keys(properties).length > 0 || lockStateChanged) {
    await updateCmsPage(page.id, properties, published);
  }

  return { pageId: page.id, published, publicationDateSet, lockStateChanged };
}

async function syncNewsletterDraftState(page: CmsPage): Promise<boolean> {
  const intro = getRichTextValue(page, CMS_PROPERTIES.newsletterIntro);
  const state = getSelectValue(page, CMS_PROPERTIES.newsletterState);
  if (intro && !state) {
    await updateCmsPage(page.id, {
      [CMS_PROPERTIES.newsletterState]: { select: { name: "Draft" } },
    });
    return true;
  }
  if (!intro && state === "Draft") {
    await updateCmsPage(page.id, {
      [CMS_PROPERTIES.newsletterState]: { select: null },
    });
    return true;
  }
  return false;
}

export async function refreshPublishedBlogData(): Promise<void> {
  // @ts-expect-error This established runtime utility is JavaScript-only.
  const { default: fetchAndStoreLatestData } = await import("../../utils/fetchAndStoreLatestData.js") as {
    default: () => Promise<void>;
  };
  await fetchAndStoreLatestData();
}

async function generateMetadata(title: string, markdown: string, existingTags: string[]): Promise<GeneratedMetadata> {
  const response = await openAiFetch("/responses", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.CMS_TEXT_MODEL || "gpt-5.6-luna",
      input: buildMetadataPrompt({ title, markdown, existingTags }),
      text: {
        format: {
          type: "json_schema",
          name: "blog_metadata",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "tag", "imageBrief", "newsletterIntro"],
            properties: {
              summary: { type: "string" },
              tag: { type: "string" },
              imageBrief: { type: "string" },
              newsletterIntro: {
                type: "string",
                maxLength: NEWSLETTER_INTRO_MAX_LENGTH,
                description: "Warm, first-person plain-text newsletter opening in one or two sentences; no greeting, subject line, markdown, or call to action.",
              },
            },
          },
        },
      },
    }),
  });
  const output = await response.json() as Record<string, unknown>;
  const text = extractOpenAiOutputText(output);
  try {
    return JSON.parse(text) as GeneratedMetadata;
  } catch {
    throw new CmsWorkflowError("OpenAI metadata response was not valid JSON.", 502);
  }
}

async function generateFeatureImage(prompt: string): Promise<Uint8Array> {
  const response = await openAiFetch("/images/generations", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.CMS_IMAGE_MODEL || "gpt-image-2",
      prompt,
      size: "1536x1024",
      quality: process.env.CMS_IMAGE_QUALITY || "high",
      output_format: "webp",
      n: 1,
    }),
  });
  const output = await response.json() as { data?: Array<{ b64_json?: string }> };
  const encoded = output.data?.[0]?.b64_json;
  if (!encoded) {
    throw new CmsWorkflowError("OpenAI did not return a generated feature image.", 502);
  }
  return Buffer.from(encoded, "base64");
}

async function uploadImageToNotion(bytes: Uint8Array, filename: string): Promise<string> {
  const upload = await notionFetch("/file_uploads", {
    method: "POST",
    body: JSON.stringify({ filename, content_type: "image/webp" }),
  });
  const uploadData = await upload.json() as { id?: string; upload_url?: string };
  if (!uploadData.id || !uploadData.upload_url) {
    throw new CmsWorkflowError("Notion did not create an image upload.", 502);
  }

  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "image/webp" }), filename);
  const sendResponse = await fetch(uploadData.upload_url, {
    method: "POST",
    headers: notionHeaders(),
    body: form,
  });
  if (!sendResponse.ok) {
    throw new CmsWorkflowError(`Notion image upload failed (${sendResponse.status}).`, 502);
  }
  return uploadData.id;
}

async function findCmsPage(recordId: number): Promise<CmsPage> {
  const dataSourceId = await resolveDataSourceId();
  const response = await notionFetch(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: 1,
      filter: {
        property: CMS_PROPERTIES.recordId,
        unique_id: { equals: recordId },
      },
    }),
  });
  const result = await response.json() as PageQueryResponse;
  const page = result.results?.[0];
  if (!page) {
    throw new CmsWorkflowError("CMS record was not found.", 404);
  }
  return page;
}

async function getCmsDataSource(): Promise<NotionDataSource> {
  const id = await resolveDataSourceId();
  const response = await notionFetch(`/data_sources/${id}`);
  return response.json() as Promise<NotionDataSource>;
}

async function getExistingSlugs(excludePageId?: string): Promise<string[]> {
  const dataSourceId = await resolveDataSourceId();
  const slugs: string[] = [];
  let cursor: string | null | undefined;
  do {
    const response = await notionFetch(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    const result = await response.json() as PageQueryResponse;
    for (const page of result.results || []) {
      if (page.id === excludePageId) continue;
      const slug = getRichTextValue(page, CMS_PROPERTIES.slug);
      if (slug) slugs.push(slug);
    }
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);
  return slugs;
}

async function updateCmsPage(pageId: string, properties: Record<string, unknown>, isLocked?: boolean): Promise<void> {
  const body: { properties?: Record<string, unknown>; is_locked?: boolean } = {};
  if (Object.keys(properties).length > 0) body.properties = properties;
  if (typeof isLocked === "boolean") body.is_locked = isLocked;

  await notionFetch(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function getCmsPage(pageId: string): Promise<CmsPage> {
  const response = await notionFetch(`/pages/${pageId}`);
  return response.json() as Promise<CmsPage>;
}

async function isCmsPage(page: CmsPage): Promise<boolean> {
  const dataSourceId = await resolveDataSourceId();
  const parent = page.parent || {};
  return parent.data_source_id === dataSourceId
    || (parent.type === "data_source_id" && parent.id === dataSourceId);
}

async function resolveDataSourceId(): Promise<string> {
  const configured = String(process.env.NOTION_DATABASE_ID || "").replace(/^collection:\/\//, "");
  if (!configured) {
    throw new CmsWorkflowError("NOTION_DATABASE_ID is not configured.", 500);
  }
  return configured;
}

async function notionFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.NOTION_API_KEY;
  if (!token) {
    throw new CmsWorkflowError("NOTION_API_KEY is not configured.", 500);
  }
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: { ...notionHeaders(), "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new CmsWorkflowError(`Notion API request failed (${response.status}): ${body.slice(0, 300)}`, 502);
  }
  return response;
}

function notionHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY || ""}`,
    "Notion-Version": NOTION_VERSION,
  };
}

async function openAiFetch(path: string, init: RequestInit): Promise<Response> {
  const token = process.env.OPENAI_API_KEY;
  if (!token) {
    throw new CmsWorkflowError("OPENAI_API_KEY is not configured.", 500);
  }
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new CmsWorkflowError(`OpenAI API request failed (${response.status}): ${body.slice(0, 300)}`, 502);
  }
  return response;
}

function metadataStateProperties(state: MetadataState, error: string): Record<string, unknown> {
  return {
    [CMS_PROPERTIES.metadataState]: { select: { name: state } },
    [CMS_PROPERTIES.metadataError]: richTextProperty(error.slice(0, 500)),
  };
}

function richTextProperty(content: string): { rich_text: Array<{ type: "text"; text: { content: string } }> } {
  return { rich_text: content ? [{ type: "text", text: { content } }] : [] };
}

function getProperty(page: CmsPage, propertyName: string): Record<string, any> {
  return (page.properties?.[propertyName] || {}) as Record<string, any>;
}

function getPropertyId(page: CmsPage, propertyName: string): string {
  return String(getProperty(page, propertyName).id || "");
}

function getTitleValue(page: CmsPage, propertyName: string): string {
  return plainText(getProperty(page, propertyName).title);
}

function getRichTextValue(page: CmsPage, propertyName: string): string {
  return plainText(getProperty(page, propertyName).rich_text);
}

function getSelectValue(page: CmsPage, propertyName: string): string {
  return getProperty(page, propertyName).select?.name || "";
}

function getCheckboxValue(page: CmsPage, propertyName: string): boolean {
  return getProperty(page, propertyName).checkbox === true;
}

function getDateValue(page: CmsPage, propertyName: string): string {
  return getProperty(page, propertyName).date?.start || "";
}

function getFileCount(page: CmsPage, propertyName: string): number {
  return Array.isArray(getProperty(page, propertyName).files) ? getProperty(page, propertyName).files.length : 0;
}

function getSelectOptions(dataSource: NotionDataSource, propertyName: string): string[] {
  const property = dataSource.properties?.[propertyName] as { select?: { options?: Array<{ name?: string }> } } | undefined;
  return (property?.select?.options || []).map((option) => option.name || "").filter(Boolean);
}

function plainText(items: Array<{ plain_text?: string }> | undefined): string {
  return (items || []).map((item) => item.plain_text || "").join("").trim();
}

function normalizeTag(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 100);
}

function extractOpenAiOutputText(output: Record<string, unknown>): string {
  if (typeof output.output_text === "string") {
    return output.output_text;
  }
  const entries = Array.isArray(output.output) ? output.output : [];
  for (const entry of entries) {
    const content = (entry as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      const text = (item as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  throw new CmsWorkflowError("OpenAI did not return metadata text.", 502);
}

function collectRecordIdCandidates(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  const direct = [object.cmsRecordId, object.recordId, object[CMS_PROPERTIES.recordId]];
  const properties = object.properties;
  if (properties && typeof properties === "object") {
    direct.push((properties as Record<string, unknown>)[CMS_PROPERTIES.recordId]);
  }
  return direct.flatMap((value) => {
    if (value && typeof value === "object") {
      const nested = value as Record<string, unknown>;
      return [nested.number, nested.value, nested.id];
    }
    return [value];
  });
}

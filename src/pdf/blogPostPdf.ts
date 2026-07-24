import { Buffer } from "node:buffer";
import PDFDocument from "pdfkit";
import sharp from "sharp";

const CONTENT_MANIFEST_KEY = "content/manifest.json";
const SITE_URL = "https://shaynemcgregor.dev";
const PDF_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
const PAGE_MARGIN = 56;
const IMAGE_TIMEOUT_MS = 8_000;
const MAX_IMAGE_HEIGHT = 360;
const MIN_IMAGE_HEIGHT = 140;
const IMAGE_BLOCK_SPACING = 36;

type PdfStore = {
  get(key: string, options: { type: "json" }): Promise<unknown>;
};

type PdfResponseOptions = {
  store: PdfStore;
  request: Request;
  fetchImplementation?: typeof fetch;
  logger?: Pick<Console, "error" | "warn">;
  siteUrl?: string;
};

type PdfPost = {
  link: string;
  title: string;
  summary: string;
  tag: string;
  publishedDate: string;
  updatedDate: string;
  thumbnail: string;
  body: unknown[];
  bodyMarkdown: string;
};

type PdfBlock = {
  type: string;
  text?: unknown;
  url?: unknown;
  caption?: unknown;
  href?: unknown;
  checked?: unknown;
};

export async function serveBlogPostPdf(options: PdfResponseOptions): Promise<Response> {
  if (options.request.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
  }

  const slug = new URL(options.request.url).searchParams.get("slug")?.trim() ?? "";
  if (!isValidSlug(slug)) {
    return new Response("Blog post not found", { status: 404 });
  }

  try {
    const manifest = asManifest(await options.store.get(CONTENT_MANIFEST_KEY, { type: "json" }));
    if (!manifest) {
      return unavailableContentResponse();
    }

    const posts = await options.store.get(manifest.current_key, { type: "json" });
    if (!Array.isArray(posts)) {
      return unavailableContentResponse();
    }

    const post = posts.map(asPdfPost).find((candidate): candidate is PdfPost => candidate?.link === slug);
    if (!post) {
      return new Response("Blog post not found", { status: 404 });
    }

    const body = await renderBlogPostPdf(post, {
      fetchImplementation: options.fetchImplementation ?? fetch,
      logger: options.logger,
      siteUrl: options.siteUrl ?? SITE_URL,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${slug}.pdf"`,
        "Cache-Control": PDF_CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    (options.logger ?? console).error("Blog PDF response failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailableContentResponse();
  }
}

export async function renderBlogPostPdf(
  post: PdfPost,
  options: Pick<PdfResponseOptions, "fetchImplementation" | "logger" | "siteUrl">
): Promise<Uint8Array> {
  const document = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: false,
    info: {
      Title: post.title,
      Author: "Shayne McGregor",
      Subject: post.summary || "Notes from Shayne",
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    document.on("error", reject);
  });
  const siteUrl = (options.siteUrl ?? SITE_URL).replace(/\/+$/, "");
  const sourceUrl = `${siteUrl}/blog/${post.link}`;

  document.fillColor("#7a4d36").font("Helvetica-Bold").fontSize(10).text("NOTES FROM SHAYNE", { characterSpacing: 1.4 });
  document.moveDown(0.7);
  document.fillColor("#1f1b18").font("Times-Bold").fontSize(28).text(post.title, { lineGap: 4 });
  document.moveDown(0.45);

  const metadata = [formatDate(post.publishedDate), post.updatedDate && post.updatedDate !== post.publishedDate ? `Updated ${formatDate(post.updatedDate)}` : "", post.tag]
    .filter(Boolean)
    .join("  ·  ");
  if (metadata) {
    document.fillColor("#6b6259").font("Helvetica").fontSize(10).text(metadata);
    document.moveDown(0.8);
  }

  if (post.summary) {
    document.fillColor("#2f2924").font("Helvetica-Oblique").fontSize(13).text(post.summary, { lineGap: 4 });
    document.moveDown(1.1);
  }

  await renderImage(document, post.thumbnail, post.title, options);
  for (const block of collectBlocks(post)) {
    await renderBlock(document, block, options);
  }

  addPageFooters(document, sourceUrl);
  document.end();
  return finished;
}

function collectBlocks(post: PdfPost): PdfBlock[] {
  const richBlocks = post.body.flatMap((section) => {
    if (!isObject(section) || !Array.isArray(section.blocks)) {
      return [];
    }
    return section.blocks.filter(isObject) as PdfBlock[];
  });
  if (richBlocks.length > 0) {
    return richBlocks;
  }

  if (post.bodyMarkdown) {
    return markdownBlocks(post.bodyMarkdown);
  }

  const legacyBlocks = post.body.flatMap((section) => {
    if (!isObject(section)) {
      return [];
    }
    const blocks: PdfBlock[] = [];
    const heading = textValue(section.heading);
    if (heading) {
      blocks.push({ type: "heading_2", text: heading });
    }
    if (Array.isArray(section.paras)) {
      for (const paragraph of section.paras) {
        if (plainText(paragraph)) {
          blocks.push({ type: "paragraph", text: paragraph });
        }
      }
    }
    return blocks;
  });
  if (legacyBlocks.length > 0) {
    return legacyBlocks;
  }

  return [];
}

async function renderBlock(document: PDFKit.PDFDocument, block: PdfBlock, options: Pick<PdfResponseOptions, "fetchImplementation" | "logger">): Promise<void> {
  const text = plainText(block.text);
  switch (block.type) {
    case "heading_1":
    case "heading_2":
    case "heading_3":
      if (text) {
        document.moveDown(0.65).fillColor("#1f1b18").font("Times-Bold").fontSize(block.type === "heading_1" ? 22 : block.type === "heading_2" ? 18 : 15).text(text, { lineGap: 2 }).moveDown(0.25);
      }
      return;
    case "quote":
      if (text) {
        document.moveDown(0.2).fillColor("#7a4d36").font("Helvetica-Oblique").fontSize(11).text(text, { indent: 18, lineGap: 4 }).moveDown(0.5);
      }
      return;
    case "callout":
      if (text) {
        document.moveDown(0.2).fillColor("#2f2924").font("Helvetica").fontSize(11).text(text, { indent: 12, lineGap: 4 }).moveDown(0.5);
      }
      return;
    case "bulleted_list_item":
    case "numbered_list_item":
      if (text) {
        const marker = block.type === "bulleted_list_item" ? "•" : "–";
        document.fillColor("#2f2924").font("Helvetica").fontSize(11).text(`${marker} ${text}`, { indent: 12, lineGap: 4 }).moveDown(0.2);
      }
      return;
    case "to_do":
      if (text) {
        document.fillColor("#2f2924").font("Helvetica").fontSize(11).text(`${block.checked === true ? "[x]" : "[ ]"} ${text}`, { indent: 12, lineGap: 4 }).moveDown(0.2);
      }
      return;
    case "code":
      if (text) {
        document.moveDown(0.2).fillColor("#2f2924").font("Courier").fontSize(9).text(text, { indent: 12, lineGap: 3 }).moveDown(0.5);
      }
      return;
    case "divider":
      document.moveDown(0.5).strokeColor("#d9d2c8").lineWidth(0.7).moveTo(PAGE_MARGIN, document.y).lineTo(document.page.width - PAGE_MARGIN, document.y).stroke().moveDown(0.6);
      return;
    case "image":
      await renderImage(document, textValue(block.url), plainText(block.caption), options);
      return;
    case "bookmark":
    case "embed":
    case "link_preview":
    case "video":
    case "file":
    case "pdf": {
      const href = textValue(block.href);
      const label = plainText(block.caption) || href;
      if (label) {
        document.fillColor("#7a4d36").font("Helvetica").fontSize(10).text(label, href ? { link: href, underline: true } : {}).moveDown(0.5);
      }
      return;
    }
    default:
      if (text) {
        renderParagraph(document, text);
      }
  }
}

function renderParagraph(document: PDFKit.PDFDocument, text: string): void {
  document.fillColor("#2f2924").font("Helvetica").fontSize(11).text(text, { lineGap: 5 }).moveDown(0.75);
}

async function renderImage(document: PDFKit.PDFDocument, source: string, caption: string, options: Pick<PdfResponseOptions, "fetchImplementation" | "logger">): Promise<void> {
  if (!isSafeImageUrl(source) || !options.fetchImplementation) {
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    const response = await options.fetchImplementation(source, { signal: controller.signal, headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*" } });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`image returned HTTP ${response.status}`);
    }
    const jpeg = await sharp(Buffer.from(await response.arrayBuffer())).rotate().jpeg({ quality: 82 }).toBuffer();
    const metadata = await sharp(jpeg).metadata();
    const contentWidth = document.page.width - PAGE_MARGIN * 2;
    const preferredLayout = imageDisplayLayout(metadata.width, metadata.height, contentWidth, MAX_IMAGE_HEIGHT);
    if (!preferredLayout) {
      throw new Error("image dimensions are unavailable");
    }
    let layout = preferredLayout;
    document.font("Helvetica-Oblique").fontSize(9);
    let captionHeight = caption ? document.heightOfString(caption, { width: layout.width, align: "center", lineGap: 3 }) + 10 : 0;
    const availableHeight = document.page.height - PAGE_MARGIN - document.y;

    if (layout.height + captionHeight + IMAGE_BLOCK_SPACING > availableHeight) {
      const remainingImageHeight = availableHeight - captionHeight - IMAGE_BLOCK_SPACING;
      const compactLayout = imageDisplayLayout(metadata.width, metadata.height, contentWidth, remainingImageHeight);
      if (compactLayout && compactLayout.height >= MIN_IMAGE_HEIGHT) {
        layout = compactLayout;
        captionHeight = caption ? document.heightOfString(caption, { width: layout.width, align: "center", lineGap: 3 }) + 10 : 0;
      }
    }

    if (layout.height + captionHeight + IMAGE_BLOCK_SPACING > availableHeight) {
      document.addPage();
      layout = preferredLayout;
      captionHeight = caption ? document.heightOfString(caption, { width: layout.width, align: "center", lineGap: 3 }) + 10 : 0;
    }

    document.moveDown(0.2);
    const imageX = (document.page.width - layout.width) / 2;
    const imageY = document.y;
    document.image(jpeg, imageX, imageY, { width: layout.width, height: layout.height });
    document.y = imageY + layout.height;
    if (caption) {
      document.moveDown(0.25);
      const captionY = document.y;
      document.fillColor("#6b6259").font("Helvetica-Oblique").fontSize(9).text(caption, imageX, captionY, { width: layout.width, align: "center", lineGap: 3 });
      document.y = captionY + captionHeight - 10;
    }
    document.x = PAGE_MARGIN;
    document.moveDown(0.8);
  } catch (error) {
    (options.logger ?? console).warn("Skipping unavailable PDF image", {
      source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function addPageFooters(document: PDFKit.PDFDocument, sourceUrl: string): void {
  const range = document.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    document.switchToPage(index);
    const bottomMargin = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    document.fillColor("#6b6259").font("Helvetica").fontSize(8);
    document.text(sourceUrl, PAGE_MARGIN, document.page.height - 34, { width: 330, link: sourceUrl, underline: true, lineBreak: false });
    document.text(`${index + 1} / ${range.count}`, document.page.width - PAGE_MARGIN - 60, document.page.height - 34, { width: 60, align: "right", lineBreak: false });
    document.page.margins.bottom = bottomMargin;
  }
}

export function imageDisplayLayout(imageWidth: number | undefined, imageHeight: number | undefined, maxWidth: number, maxHeight: number): { width: number; height: number } | null {
  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return null;
  }
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight, 1);
  return {
    width: Number((imageWidth * scale).toFixed(2)),
    height: Number((imageHeight * scale).toFixed(2)),
  };
}

function markdownBlocks(markdown: string): PdfBlock[] {
  if (!markdown) {
    return [];
  }
  return markdown.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).map((part) => {
    const image = /^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (image) {
      return { type: "image", url: image[2], caption: image[1] };
    }
    const heading = /^(#{1,3})\s+(.+)/.exec(part);
    if (heading) {
      return { type: `heading_${heading[1].length}`, text: stripMarkdown(heading[2]) };
    }
    if (/^```/.test(part)) {
      return { type: "code", text: part.replace(/^```[^\n]*\n?|```$/g, "") };
    }
    if (/^>\s?/.test(part)) {
      return { type: "quote", text: stripMarkdown(part.replace(/^>\s?/gm, " ")) };
    }
    if (/^(?:[-*+]\s+|\d+\.\s+)/.test(part)) {
      return { type: "bulleted_list_item", text: stripMarkdown(part.replace(/^(?:[-*+]\s+|\d+\.\s+)/gm, "• ")) };
    }
    return { type: "paragraph", text: stripMarkdown(part) };
  });
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asManifest(value: unknown): { current_key: string } | null {
  if (!isObject(value) || typeof value.current_key !== "string" || !value.current_key.trim()) {
    return null;
  }
  return { current_key: value.current_key.trim() };
}

function asPdfPost(value: unknown): PdfPost | null {
  if (!isObject(value)) {
    return null;
  }
  const link = textValue(value.link);
  const title = textValue(value.title);
  if (!link || !title || !isValidSlug(link)) {
    return null;
  }
  return {
    link,
    title,
    summary: textValue(value.summary),
    tag: textValue(value.tag),
    publishedDate: textValue(value.publishedDate),
    updatedDate: textValue(value.updatedDate),
    thumbnail: textValue(value.thumbnail),
    body: Array.isArray(value.body) ? value.body : [],
    bodyMarkdown: textValue(value.bodyMarkdown),
  };
}

function plainText(value: unknown): string {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((part) => typeof part === "string" ? part : isObject(part) ? textValue(part.text) : "").join("").replace(/\s+/g, " ").trim();
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}

function isSafeImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "";
  }
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(new Date(timestamp));
}

function unavailableContentResponse(): Response {
  return new Response("Current blog content is unavailable", {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

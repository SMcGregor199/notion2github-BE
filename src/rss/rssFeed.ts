export type RSSBlogPostInput = {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  link?: unknown;
  thumbnail?: unknown;
  publishedDate?: unknown;
  updatedDate?: unknown;
  body?: unknown;
};

export type RSSFeedConfig = {
  siteBaseUrl?: string;
  feedUrl?: string;
  title?: string;
  description?: string;
  language?: string;
  ttl?: number;
  buildTime?: Date;
};

type NormalizedRSSPost = {
  id: string;
  title: string;
  description: string;
  link: string;
  thumbnail?: string;
  thumbnailType?: string;
  publishedAt: Date;
};

const DEFAULT_SITE_BASE_URL = "https://shaynemcgregor.dev";
const DEFAULT_FEED_URL = "https://shaynemcgregor.dev/rss.xml";

export function generateRSSFeedXML(posts: RSSBlogPostInput[], config: RSSFeedConfig = {}): string {
  const normalizedConfig = normalizeConfig(config);
  const normalizedPosts = posts.map((post) => normalizePost(post, normalizedConfig.siteBaseUrl));
  normalizedPosts.sort((a, b) => {
    const timeDifference = b.publishedAt.getTime() - a.publishedAt.getTime();
    if (timeDifference !== 0) return timeDifference;
    return a.id.localeCompare(b.id);
  });

  const items = normalizedPosts.map((post) => renderItem(post)).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXML(normalizedConfig.title)}</title>`,
    `    <link>${escapeXML(normalizedConfig.siteBaseUrl)}</link>`,
    `    <description>${escapeXML(normalizedConfig.description)}</description>`,
    `    <atom:link href="${escapeXMLAttribute(normalizedConfig.feedUrl)}" rel="self" type="application/rss+xml" />`,
    `    <lastBuildDate>${formatRSSDate(normalizedConfig.buildTime)}</lastBuildDate>`,
    `    <language>${escapeXML(normalizedConfig.language)}</language>`,
    `    <ttl>${normalizedConfig.ttl}</ttl>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].filter((line) => line !== "").join("\n");
}

export function validateRSSXML(xml: string): void {
  if (!xml.includes("<rss ") || !xml.includes("<channel>") || !xml.includes("</rss>")) {
    throw new Error("Generated RSS XML is missing required RSS/channel elements.");
  }
  if (!xml.includes('xmlns:atom="http://www.w3.org/2005/Atom"')) {
    throw new Error("Generated RSS XML is missing the atom namespace.");
  }
}

function normalizeConfig(config: RSSFeedConfig): Required<RSSFeedConfig> {
  return {
    siteBaseUrl: trimTrailingSlash(config.siteBaseUrl ?? DEFAULT_SITE_BASE_URL),
    feedUrl: config.feedUrl?.trim() || DEFAULT_FEED_URL,
    title: config.title?.trim() || "shaynemcgregor.dev",
    description: config.description?.trim() || "Posts from shaynemcgregor.dev",
    language: config.language?.trim() || "en-us",
    ttl: config.ttl && config.ttl > 0 ? config.ttl : 60,
    buildTime: config.buildTime ?? new Date(),
  };
}

function normalizePost(post: RSSBlogPostInput, siteBaseUrl: string): NormalizedRSSPost {
  const id = stringField(post.id);
  if (!id) throw new Error("RSS post is missing stable id.");

  const title = stringField(post.title);
  if (!title) throw new Error(`RSS post ${id} is missing title.`);

  const slugOrUrl = stringField(post.link);
  if (!slugOrUrl) throw new Error(`RSS post ${id} is missing link.`);

  const publishedDate = stringField(post.publishedDate);
  if (!publishedDate) throw new Error(`RSS post ${id} is missing publishedDate.`);
  const publishedAt = new Date(publishedDate);
  if (Number.isNaN(publishedAt.getTime())) {
    throw new Error(`RSS post ${id} has invalid publishedDate.`);
  }

  const thumbnail = stringField(post.thumbnail);
  const validThumbnail = isHTTPURL(thumbnail) ? thumbnail : undefined;

  return {
    id,
    title,
    description: descriptionFromPost(post),
    link: postURL(siteBaseUrl, slugOrUrl),
    thumbnail: validThumbnail,
    thumbnailType: validThumbnail ? imageContentType(validThumbnail) : undefined,
    publishedAt,
  };
}

function renderItem(post: NormalizedRSSPost): string {
  const lines = [
    "    <item>",
    `      <title>${escapeXML(post.title)}</title>`,
    `      <link>${escapeXML(post.link)}</link>`,
  ];

  if (post.description) {
    lines.push(`      <description>${escapeXML(post.description)}</description>`);
  }

  lines.push(
    `      <guid isPermaLink="false">${escapeXML(post.id)}</guid>`,
    `      <pubDate>${formatRSSDate(post.publishedAt)}</pubDate>`,
  );

  if (post.thumbnail && post.thumbnailType) {
    lines.push(
      `      <enclosure url="${escapeXMLAttribute(post.thumbnail)}" type="${escapeXMLAttribute(post.thumbnailType)}" />`,
    );
  }

  lines.push("    </item>");
  return lines.join("\n");
}

function postURL(siteBaseUrl: string, slugOrUrl: string): string {
  if (isHTTPURL(slugOrUrl)) return slugOrUrl;

  const trimmed = slugOrUrl.trim().replace(/^\/+/, "");
  const blogPath = trimmed.startsWith("blog/") ? trimmed : `blog/${trimmed}`;
  return `${trimTrailingSlash(siteBaseUrl)}/${blogPath}`;
}

function descriptionFromPost(post: RSSBlogPostInput): string {
  const summary = stringField(post.summary);
  if (summary) return summary;

  if (!Array.isArray(post.body)) return "";
  for (const section of post.body) {
    if (!section || typeof section !== "object" || !("paras" in section)) continue;
    const paras = (section as { paras?: unknown }).paras;
    if (!Array.isArray(paras)) continue;
    for (const para of paras) {
      const text = stringField(para);
      if (text) return text;
    }
  }

  return "";
}

function imageContentType(imageUrl: string): string {
  const pathname = new URL(imageUrl).pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".gif")) return "image/gif";
  return "image/webp";
}

function isHTTPURL(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatRSSDate(date: Date): string {
  return date.toUTCString().replace("GMT", "+0000");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function escapeXML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeXMLAttribute(value: string): string {
  return escapeXML(value).replaceAll('"', "&quot;");
}

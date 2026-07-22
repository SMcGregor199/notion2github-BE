export const SITEMAP_CONTENT_TYPE = "application/xml; charset=utf-8";
export const SITEMAP_CACHE_CONTROL = "max-age=60, stale-while-revalidate=300";
export const SITEMAP_SITE_URL = "https://shaynemcgregor.dev";
export const CONTENT_MANIFEST_KEY = "content/manifest.json";

type SitemapStore = {
  get(key: string, options: { type: "json" }): Promise<unknown>;
};

type SitemapResponseOptions = {
  store: SitemapStore;
  siteUrl?: string;
  logger?: Pick<Console, "error">;
};

type CurrentContentManifest = {
  current_key: string;
};

type SitemapPost = {
  link?: unknown;
  updatedDate?: unknown;
  publishedDate?: unknown;
};

export async function servePostsSitemap(options: SitemapResponseOptions): Promise<Response> {
  const logger = options.logger ?? console;

  try {
    const manifest = asCurrentContentManifest(await options.store.get(CONTENT_MANIFEST_KEY, { type: "json" }));
    if (!manifest) {
      return unavailableContentResponse();
    }

    const posts = await options.store.get(manifest.current_key, { type: "json" });
    if (!Array.isArray(posts)) {
      return unavailableContentResponse();
    }

    return new Response(buildPostsSitemap(posts, options.siteUrl), {
      status: 200,
      headers: {
        "Content-Type": SITEMAP_CONTENT_TYPE,
        "Cache-Control": SITEMAP_CACHE_CONTROL,
      },
    });
  } catch (error) {
    logger.error("Posts sitemap response failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailableContentResponse();
  }
}

export function buildPostsSitemap(posts: unknown[], siteUrl = SITEMAP_SITE_URL): string {
  const canonicalSiteUrl = siteUrl.trim().replace(/\/+$/, "");
  const urls = posts
    .map(asSitemapPost)
    .filter((post): post is SitemapPost => post !== null)
    .map((post) => sitemapUrlEntry(post, canonicalSiteUrl))
    .filter((entry): entry is string => entry !== null);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  ${url}`),
    "</urlset>",
    "",
  ].join("\n");
}

function asCurrentContentManifest(value: unknown): CurrentContentManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const currentKey = (value as { current_key?: unknown }).current_key;
  return typeof currentKey === "string" && currentKey.trim() ? { current_key: currentKey.trim() } : null;
}

function asSitemapPost(value: unknown): SitemapPost | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SitemapPost : null;
}

function sitemapUrlEntry(post: SitemapPost, siteUrl: string): string | null {
  const slug = stringValue(post.link);
  if (!slug || !isValidSlug(slug)) {
    return null;
  }

  const lastModified = validLastModified(post.updatedDate) ?? validLastModified(post.publishedDate);
  const lines = [`<url><loc>${escapeXml(`${siteUrl}/blog/${slug}`)}</loc>`];
  if (lastModified) {
    lines.push(`<lastmod>${escapeXml(lastModified)}</lastmod>`);
  }
  lines.push("</url>");
  return lines.join("");
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug);
}

function validLastModified(value: unknown): string | null {
  const dateValue = stringValue(value);
  if (!dateValue || !isValidSitemapDate(dateValue)) {
    return null;
  }

  return dateValue;
}

function isValidSitemapDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function unavailableContentResponse(): Response {
  return new Response("Current blog content is unavailable", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

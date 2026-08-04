import type { ResourceGuideNotionClient, ResourceGuideStore } from "./types.js";
import { loadResourceGuide, ResourceGuideUnavailableError } from "./resourceGuideService.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://shaynemcgregor.dev",
  "https://www.shaynemcgregor.dev",
  "http://localhost:5173",
];

type ResourceGuideHandlerOptions = {
  store: ResourceGuideStore;
  notion: ResourceGuideNotionClient;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  logger?: Pick<Console, "error">;
};

export function createResourceGuideHandler(options: ResourceGuideHandlerOptions) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;

  return async function resourceGuideHandler(request: Request): Promise<Response> {
    const corsHeaders = buildCorsHeaders(request.headers.get("origin"), env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "GET") {
      return jsonResponse({ error: { code: "method_not_allowed", message: "Method not allowed." } }, 405, {
        ...corsHeaders,
        Allow: "GET, OPTIONS",
      });
    }

    const databaseId = env.NOTION_RESOURCES_DATABASE_ID?.trim();
    if (!databaseId) {
      logger.error("Resource Guide is not configured", { missing: "NOTION_RESOURCES_DATABASE_ID" });
      return jsonResponse({ error: { code: "resource_guide_unavailable", message: "Resource Guide data is temporarily unavailable." } }, 503, corsHeaders);
    }

    try {
      const result = await loadResourceGuide({
        store: options.store,
        notion: options.notion,
        databaseId,
        now: options.now?.(),
        cacheTtlMs: cacheTtlMs(env),
      });
      return jsonResponse(result.response, 200, {
        ...corsHeaders,
        ETag: result.etag,
        "Cache-Control": "max-age=300, stale-while-revalidate=3600",
        "X-Resource-Guide-Cache": result.stale ? "stale" : "fresh",
      });
    } catch (error) {
      logger.error("Resource Guide response failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      const status = error instanceof ResourceGuideUnavailableError ? 503 : 500;
      return jsonResponse({ error: { code: "resource_guide_unavailable", message: "Resource Guide data is temporarily unavailable." } }, status, corsHeaders);
    }
  };
}

function buildCorsHeaders(origin: string | null, env: NodeJS.ProcessEnv): Record<string, string> {
  const allowedOrigins = (env.RESOURCE_GUIDE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const permitted = allowedOrigins.length ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (origin && permitted.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function cacheTtlMs(env: NodeJS.ProcessEnv): number | undefined {
  const seconds = Number(env.RESOURCE_GUIDE_CACHE_TTL_SECONDS);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

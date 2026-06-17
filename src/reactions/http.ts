import { createAirtableReactionAdapter } from "./airtableReactionAdapter.js";
import {
  ReactionValidationError,
  isReactionKey,
  readReactionState,
  submitReaction,
} from "./reactionService.js";
import type { ReactionRequest } from "./types.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://shaynemcgregor.dev",
  "https://www.shaynemcgregor.dev",
  "http://localhost:5173",
];

export async function handleReactionRequest(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const postId = url.searchParams.get("postId") ?? "";
      const blogTitle = url.searchParams.get("blogTitle") ?? undefined;
      const visitorId = url.searchParams.get("visitorId") ?? undefined;
      const body = await readReactionState(createAirtableReactionAdapter(), {
        postId,
        blogTitle,
        visitorId,
      });
      return jsonResponse(body, 200, corsHeaders);
    }

    if (request.method === "POST") {
      const body = parseReactionRequest(await readJsonBody(request));
      const response = await submitReaction(createAirtableReactionAdapter(), body);
      return jsonResponse(response, 200, corsHeaders);
    }

    return jsonResponse({ error: "Method not allowed." }, 405, {
      ...corsHeaders,
      Allow: "GET, POST, OPTIONS",
    });
  } catch (err) {
    if (err instanceof ReactionValidationError) {
      return jsonResponse({ error: err.message }, err.status, corsHeaders);
    }

    console.error("Reaction API error", err);
    return jsonResponse({ error: "Unable to update reactions." }, 500, corsHeaders);
  }
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigins = getAllowedOrigins();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };

  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function getAllowedOrigins(): string[] {
  const configured = process.env.REACTION_ALLOWED_ORIGINS;
  if (!configured) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 4096) {
    throw new ReactionValidationError("Request body is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ReactionValidationError("Invalid JSON body.");
  }
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function parseReactionRequest(value: unknown): ReactionRequest {
  if (!value || typeof value !== "object") {
    throw new ReactionValidationError("Invalid JSON body.");
  }

  const record = value as Record<string, unknown>;
  const reaction = record.reaction;
  if (reaction !== null && reaction !== undefined && !isReactionKey(reaction)) {
    throw new ReactionValidationError("Invalid reaction.");
  }

  return {
    postId: record.postId,
    blogTitle: typeof record.blogTitle === "string" ? record.blogTitle : undefined,
    visitorId: record.visitorId,
    reaction: reaction === undefined ? null : reaction,
  } as ReactionRequest;
}

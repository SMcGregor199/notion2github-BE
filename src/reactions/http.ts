import { createAirtableReactionAdapter } from "./airtableReactionAdapter.js";
import {
  ReactionSetupError,
  ReactionValidationError,
  isLazyAggregateUpsertEnabled,
  isReactionKey,
  readReactionState,
  submitReaction,
} from "./reactionService.js";
import type { ReactionAdapter, ReactionErrorBody, ReactionRequest } from "./types.js";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://shaynemcgregor.dev",
  "https://www.shaynemcgregor.dev",
  "http://localhost:5173",
];

export async function handleReactionRequest(
  request: Request,
  adapter?: ReactionAdapter,
): Promise<Response> {
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
      const reactionAdapter = adapter ?? createAirtableReactionAdapter();
      const url = new URL(request.url);
      const postId = url.searchParams.get("postId") ?? "";
      const blogTitle = url.searchParams.get("blogTitle") ?? undefined;
      const visitorId = url.searchParams.get("visitorId") ?? undefined;
      const body = await readReactionState(
        reactionAdapter,
        {
          postId,
          blogTitle,
          visitorId,
        },
        {
          allowAggregateCreate: isLazyAggregateUpsertEnabled(),
        },
      );
      return jsonResponse(body, 200, corsHeaders);
    }

    if (request.method === "POST") {
      const reactionAdapter = adapter ?? createAirtableReactionAdapter();
      const body = parseReactionRequest(await readJsonBody(request));
      const response = await submitReaction(reactionAdapter, body, {
        allowAggregateCreate: isLazyAggregateUpsertEnabled(),
      });
      return jsonResponse(response, 200, corsHeaders);
    }

    return jsonResponse(errorBody("invalid_request", "Method not allowed."), 405, {
      ...corsHeaders,
      Allow: "GET, POST, OPTIONS",
    });
  } catch (err) {
    if (err instanceof ReactionValidationError) {
      logReactionError("validation", err.code, request);
      return jsonResponse(errorBody(err.code, err.message), err.status, corsHeaders);
    }

    if (err instanceof ReactionSetupError) {
      logReactionError("setup", err.code, request);
      return jsonResponse(errorBody(err.code, err.message), err.status, corsHeaders);
    }

    console.error("Reaction API unexpected error", {
      method: request.method,
      path: safePath(request.url),
      errorType: err instanceof Error ? err.name : typeof err,
    });
    return jsonResponse(
      errorBody("reaction_setup_unavailable", "Reaction data is temporarily unavailable."),
      500,
      corsHeaders,
    );
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
    throw new ReactionValidationError("invalid_request", "Request body is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ReactionValidationError("invalid_request", "Invalid JSON body.");
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
    throw new ReactionValidationError("invalid_request", "Invalid JSON body.");
  }

  const record = value as Record<string, unknown>;
  const reaction = record.reaction;
  if (reaction !== null && reaction !== undefined && !isReactionKey(reaction)) {
    throw new ReactionValidationError("invalid_reaction", "Invalid reaction.");
  }

  return {
    postId: record.postId,
    blogTitle: typeof record.blogTitle === "string" ? record.blogTitle : undefined,
    visitorId: record.visitorId,
    reaction: reaction === undefined ? null : reaction,
  } as ReactionRequest;
}

function errorBody(code: ReactionErrorBody["error"]["code"], message: string): ReactionErrorBody {
  return {
    error: {
      code,
      message,
    },
  };
}

function logReactionError(kind: string, code: string, request: Request): void {
  const url = new URL(request.url);
  const postId = request.method === "GET" ? url.searchParams.get("postId") : undefined;
  console.error("Reaction API controlled error", {
    kind,
    code,
    method: request.method,
    path: url.pathname,
    postIdShape: postId ? describePostIdShape(postId) : "body_or_absent",
  });
}

function safePath(url: string): string {
  return new URL(url).pathname;
}

function describePostIdShape(postId: string): string {
  if (!postId) {
    return "missing";
  }
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(postId)) {
    return "valid_shape";
  }
  return "invalid_shape";
}

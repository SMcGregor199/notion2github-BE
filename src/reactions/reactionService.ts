import type {
  AggregateRecord,
  ReactionAdapter,
  ReactionCounts,
  ReactionErrorCode,
  ReactionKey,
  ReactionRequest,
  ReactionState,
  SelectionRecord,
} from "./types.js";

export const REACTION_FIELDS: Record<ReactionKey, string> = {
  love: "Loved",
  confusing: "Confused",
  thoughtProvoking: "Thought Provoking",
};

export const REACTION_KEYS = Object.keys(REACTION_FIELDS) as ReactionKey[];

const EMPTY_COUNTS: ReactionCounts = {
  love: 0,
  confusing: 0,
  thoughtProvoking: 0,
};

const POST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const VISITOR_ID_PATTERN = /^rxv_[A-Za-z0-9_-]{16,96}$/;

export class ReactionValidationError extends Error {
  constructor(
    public readonly code: ReactionErrorCode,
    message: string,
  ) {
    super(message);
  }

  status = 400;
}

export class ReactionSetupError extends Error {
  constructor(
    public readonly code: ReactionErrorCode,
    message: string,
    public readonly status = 503,
  ) {
    super(message);
  }
}

type AggregateOptions = {
  allowAggregateCreate?: boolean;
};

export function isLazyAggregateUpsertEnabled(): boolean {
  return process.env.REACTION_ENABLE_LAZY_AGGREGATE_UPSERT === "true";
}

export function emptyReactionCounts(): ReactionCounts {
  return { ...EMPTY_COUNTS };
}

export function isReactionKey(value: unknown): value is ReactionKey {
  return typeof value === "string" && REACTION_KEYS.includes(value as ReactionKey);
}

export function normalizeCounts(counts: Partial<ReactionCounts> | undefined): ReactionCounts {
  const next = emptyReactionCounts();
  for (const key of REACTION_KEYS) {
    const value = counts?.[key];
    next[key] = typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return next;
}

export function validatePostId(postId: unknown): string {
  if (typeof postId !== "string" || !POST_ID_PATTERN.test(postId)) {
    throw new ReactionValidationError("invalid_post_id", "Invalid post id.");
  }
  return postId;
}

export function validateVisitorId(visitorId: unknown): string {
  if (typeof visitorId !== "string" || !VISITOR_ID_PATTERN.test(visitorId)) {
    throw new ReactionValidationError("invalid_visitor_id", "Invalid visitor id.");
  }
  return visitorId;
}

export function validateReaction(value: unknown): ReactionKey | null {
  if (value === null) {
    return null;
  }
  if (!isReactionKey(value)) {
    throw new ReactionValidationError("invalid_reaction", "Invalid reaction.");
  }
  return value;
}

export async function readReactionState(
  adapter: ReactionAdapter,
  request: Pick<ReactionRequest, "postId" | "blogTitle" | "visitorId">,
  options: AggregateOptions = {},
): Promise<ReactionState> {
  const postId = validatePostId(request.postId);
  const visitorId = request.visitorId ? validateVisitorId(request.visitorId) : null;
  const aggregate = await ensureAggregate(adapter, postId, request.blogTitle, options);
  const selection = visitorId ? await adapter.findSelection(postId, visitorId) : null;

  return {
    postId,
    counts: normalizeCounts(aggregate.counts),
    selectedReaction: selection?.reaction ?? null,
  };
}

export async function submitReaction(
  adapter: ReactionAdapter,
  request: ReactionRequest,
  options: AggregateOptions = {},
): Promise<ReactionState> {
  const postId = validatePostId(request.postId);
  const visitorId = validateVisitorId(request.visitorId);
  const requestedReaction = validateReaction(request.reaction);
  const aggregate = await ensureAggregate(adapter, postId, request.blogTitle, options);
  const previousSelection = await adapter.findSelection(postId, visitorId);
  const counts = applyReactionDelta(aggregate.counts, previousSelection, requestedReaction);
  const updatedAggregate = await adapter.updateAggregateCounts(aggregate.recordId, counts);

  const nextSelectedReaction = previousSelection?.reaction === requestedReaction ? null : requestedReaction;

  if (nextSelectedReaction === null) {
    if (previousSelection) {
      await adapter.deleteSelection(previousSelection.recordId);
    }
  } else if (!previousSelection) {
    await adapter.createSelection(postId, visitorId, nextSelectedReaction);
  } else if (previousSelection.reaction !== nextSelectedReaction) {
    await adapter.updateSelection(previousSelection.recordId, nextSelectedReaction);
  }

  return {
    postId,
    counts: normalizeCounts(updatedAggregate.counts),
    selectedReaction: nextSelectedReaction,
  };
}

async function ensureAggregate(
  adapter: ReactionAdapter,
  postId: string,
  blogTitle = "Untitled post",
  options: AggregateOptions = {},
): Promise<AggregateRecord> {
  const existing = await adapter.findAggregateByPostId(postId);
  if (existing) {
    return {
      ...existing,
      counts: normalizeCounts(existing.counts),
    };
  }
  if (!options.allowAggregateCreate) {
    throw new ReactionSetupError(
      "missing_aggregate_record",
      "Reaction counts are not configured for this post yet.",
    );
  }
  return adapter.createAggregate(postId, blogTitle.trim() || "Untitled post");
}

function applyReactionDelta(
  currentCounts: ReactionCounts,
  previousSelection: SelectionRecord | null,
  requestedReaction: ReactionKey | null,
): ReactionCounts {
  const next = normalizeCounts(currentCounts);
  const previousReaction = previousSelection?.reaction ?? null;

  if (previousReaction === requestedReaction) {
    if (requestedReaction !== null) {
      next[requestedReaction] = Math.max(0, next[requestedReaction] - 1);
    }
    return next;
  }

  if (previousReaction !== null) {
    next[previousReaction] = Math.max(0, next[previousReaction] - 1);
  }

  if (requestedReaction !== null) {
    next[requestedReaction] += 1;
  }

  return next;
}

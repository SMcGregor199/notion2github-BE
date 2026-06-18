import {
  ReactionSetupError,
  normalizeCounts,
  validatePostId,
} from "./reactionService.js";
import type { AggregateRecord, ReactionCounts } from "./types.js";

export type PublicBlogPostInput = {
  id?: unknown;
  title?: unknown;
  link?: unknown;
  draft?: unknown;
  published?: unknown;
  public?: unknown;
  renderReactions?: unknown;
};

export type AggregateSetupMode = "dry-run" | "write";

export type AggregateSetupAdapter = {
  findAggregatesByPostId(postId: string): Promise<AggregateRecord[]>;
  createAggregate(postId: string, blogTitle: string): Promise<AggregateRecord>;
  verifyAggregateSetup?(): Promise<void>;
};

export type AggregateSetupPostReport = {
  postId: string;
  blogTitle: string;
  slug?: string;
  status: "present" | "missing" | "created" | "duplicate";
  existingRecordCount: number;
};

export type AggregateSetupBlocker = {
  code:
    | "duplicate_aggregate_records"
    | "invalid_public_post"
    | "missing_blog_title"
    | "setup_error";
  message: string;
  postId?: string;
  slug?: string;
  existingRecordCount?: number;
};

export type AggregateSetupResult = {
  mode: AggregateSetupMode;
  inspectedPosts: number;
  presentRows: number;
  missingRows: number;
  plannedCreates: number;
  createdRows: number;
  duplicateRows: number;
  skippedNonPublicPosts: number;
  skippedInvalidPosts: number;
  posts: AggregateSetupPostReport[];
  blockers: AggregateSetupBlocker[];
};

type NormalizedPost = {
  postId: string;
  blogTitle: string;
  slug?: string;
};

const EMPTY_COUNTS: ReactionCounts = {
  love: 0,
  confusing: 0,
  thoughtProvoking: 0,
};

export async function setupReactionAggregates(
  adapter: AggregateSetupAdapter,
  publicPosts: PublicBlogPostInput[],
  mode: AggregateSetupMode = "dry-run",
): Promise<AggregateSetupResult> {
  if (mode !== "dry-run" && mode !== "write") {
    throw new ReactionSetupError("invalid_request", "Invalid reaction aggregate setup mode.", 400);
  }

  await adapter.verifyAggregateSetup?.();

  const result = emptyResult(mode, publicPosts.length);
  const reactionPosts = selectReactionRenderablePosts(publicPosts);
  result.skippedNonPublicPosts = publicPosts.length - reactionPosts.length;
  const missingPosts: NormalizedPost[] = [];

  for (const inputPost of reactionPosts) {
    const normalized = normalizePublicPost(inputPost);
    if (!normalized.ok) {
      result.skippedInvalidPosts += 1;
      result.blockers.push(normalized.blocker);
      continue;
    }

    const records = await adapter.findAggregatesByPostId(normalized.post.postId);

    if (records.length > 1) {
      result.duplicateRows += 1;
      result.blockers.push({
        code: "duplicate_aggregate_records",
        message: "Duplicate reaction aggregate records exist for a public post.",
        postId: normalized.post.postId,
        slug: normalized.post.slug,
        existingRecordCount: records.length,
      });
      result.posts.push({
        ...normalized.post,
        status: "duplicate",
        existingRecordCount: records.length,
      });
      continue;
    }

    if (records.length === 1) {
      result.presentRows += 1;
      result.posts.push({
        ...normalized.post,
        status: "present",
        existingRecordCount: 1,
      });
      continue;
    }

    result.missingRows += 1;
    result.plannedCreates += 1;
    missingPosts.push(normalized.post);
    result.posts.push({
      ...normalized.post,
      status: "missing",
      existingRecordCount: 0,
    });
  }

  if (result.blockers.length > 0 || mode === "dry-run") {
    return result;
  }

  for (const post of missingPosts) {
    const created = await adapter.createAggregate(post.postId, post.blogTitle);
    const createdCounts = normalizeCounts(created.counts);
    assertZeroCountRecord(createdCounts, post.postId);
    result.createdRows += 1;
    const report = result.posts.find(
      (item) => item.postId === post.postId && item.status === "missing",
    );
    if (report) {
      report.status = "created";
    }
  }

  return result;
}

export function selectReactionRenderablePosts(publicPosts: PublicBlogPostInput[]): PublicBlogPostInput[] {
  return publicPosts.filter((post) => {
    if (post.draft === true || post.published === false || post.public === false) {
      return false;
    }
    if (post.renderReactions === false) {
      return false;
    }
    return true;
  });
}

function normalizePublicPost(
  inputPost: PublicBlogPostInput,
): { ok: true; post: NormalizedPost } | { ok: false; blocker: AggregateSetupBlocker } {
  const slug = typeof inputPost.link === "string" && inputPost.link.trim()
    ? inputPost.link.trim()
    : undefined;

  let postId: string;
  try {
    postId = validatePostId(inputPost.id);
  } catch {
    return {
      ok: false,
      blocker: {
        code: "invalid_public_post",
        message: "Public post is missing a stable valid id.",
        slug,
      },
    };
  }

  if (typeof inputPost.title !== "string" || !inputPost.title.trim()) {
    return {
      ok: false,
      blocker: {
        code: "missing_blog_title",
        message: "Public post is missing a blog title.",
        postId,
        slug,
      },
    };
  }

  return {
    ok: true,
    post: {
      postId,
      blogTitle: inputPost.title.trim(),
      slug,
    },
  };
}

function assertZeroCountRecord(counts: ReactionCounts, postId: string): void {
  if (
    counts.love !== EMPTY_COUNTS.love ||
    counts.confusing !== EMPTY_COUNTS.confusing ||
    counts.thoughtProvoking !== EMPTY_COUNTS.thoughtProvoking
  ) {
    throw new ReactionSetupError(
      "airtable_transient_failure",
      `Created reaction aggregate for ${postId} did not return zero counts.`,
      502,
    );
  }
}

function emptyResult(mode: AggregateSetupMode, inspectedPosts: number): AggregateSetupResult {
  return {
    mode,
    inspectedPosts,
    presentRows: 0,
    missingRows: 0,
    plannedCreates: 0,
    createdRows: 0,
    duplicateRows: 0,
    skippedNonPublicPosts: 0,
    skippedInvalidPosts: 0,
    posts: [],
    blockers: [],
  };
}

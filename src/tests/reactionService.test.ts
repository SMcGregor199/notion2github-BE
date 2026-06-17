import { afterEach, describe, expect, it } from "vitest";
import { handleReactionRequest } from "../reactions/http.js";
import {
  ReactionSetupError,
  readReactionState,
  submitReaction,
} from "../reactions/reactionService.js";
import type {
  AggregateRecord,
  ReactionAdapter,
  ReactionCounts,
  ReactionKey,
  SelectionRecord,
} from "../reactions/types.js";

class MemoryReactionAdapter implements ReactionAdapter {
  aggregates = new Map<string, AggregateRecord>();
  selections = new Map<string, SelectionRecord>();
  createAggregateCalls = 0;
  findAggregateError: Error | null = null;
  findSelectionError: Error | null = null;
  updateAggregateError: Error | null = null;

  async findAggregateByPostId(postId: string): Promise<AggregateRecord | null> {
    if (this.findAggregateError) {
      throw this.findAggregateError;
    }
    return this.aggregates.get(postId) ?? null;
  }

  async createAggregate(postId: string, blogTitle: string): Promise<AggregateRecord> {
    this.createAggregateCalls += 1;
    const aggregate = {
      recordId: `agg_${postId}`,
      postId,
      blogTitle,
      counts: counts(),
    };
    this.aggregates.set(postId, aggregate);
    return aggregate;
  }

  async updateAggregateCounts(recordId: string, nextCounts: ReactionCounts): Promise<AggregateRecord> {
    if (this.updateAggregateError) {
      throw this.updateAggregateError;
    }
    const aggregate = [...this.aggregates.values()].find((item) => item.recordId === recordId);
    if (!aggregate) {
      throw new Error("missing aggregate");
    }
    aggregate.counts = { ...nextCounts };
    return aggregate;
  }

  async findSelection(postId: string, visitorId: string): Promise<SelectionRecord | null> {
    if (this.findSelectionError) {
      throw this.findSelectionError;
    }
    return this.selections.get(`${postId}:${visitorId}`) ?? null;
  }

  async createSelection(
    postId: string,
    visitorId: string,
    reaction: ReactionKey,
  ): Promise<SelectionRecord> {
    const selection = {
      recordId: `sel_${postId}_${visitorId}`,
      postId,
      visitorId,
      reaction,
    };
    this.selections.set(`${postId}:${visitorId}`, selection);
    return selection;
  }

  async updateSelection(recordId: string, reaction: ReactionKey): Promise<SelectionRecord> {
    const selection = [...this.selections.values()].find((item) => item.recordId === recordId);
    if (!selection) {
      throw new Error("missing selection");
    }
    selection.reaction = reaction;
    return selection;
  }

  async deleteSelection(recordId: string): Promise<void> {
    for (const [key, selection] of this.selections) {
      if (selection.recordId === recordId) {
        this.selections.delete(key);
      }
    }
  }
}

const visitorId = "rxv_abcdefghijklmnop";

describe("reaction service", () => {
  afterEach(() => {
    delete process.env.REACTION_ENABLE_LAZY_AGGREGATE_UPSERT;
  });

  it("returns setup-needed when reading a missing aggregate with lazy writes disabled", async () => {
    const adapter = new MemoryReactionAdapter();

    await expect(
      readReactionState(adapter, {
        postId: "post_123",
        blogTitle: "Post Title",
        visitorId,
      }),
    ).rejects.toMatchObject({
      code: "missing_aggregate_record",
      status: 503,
    });
    expect(adapter.createAggregateCalls).toBe(0);
  });

  it("creates a missing aggregate when reading state with lazy writes enabled", async () => {
    const adapter = new MemoryReactionAdapter();

    const state = await readReactionState(
      adapter,
      {
        postId: "post_123",
        blogTitle: "Post Title",
        visitorId,
      },
      {
        allowAggregateCreate: true,
      },
    );

    expect(state.counts).toEqual(counts());
    expect(state.selectedReaction).toBeNull();
    expect(adapter.createAggregateCalls).toBe(1);
  });

  it("selects, deselects, and deletes visitor selection for the same reaction", async () => {
    const adapter = new MemoryReactionAdapter();

    const selected = await submitReaction(
      adapter,
      {
        postId: "post_123",
        blogTitle: "Post Title",
        visitorId,
        reaction: "love",
      },
      { allowAggregateCreate: true },
    );
    expect(selected.counts).toEqual(counts({ love: 1 }));
    expect(selected.selectedReaction).toBe("love");

    const deselected = await submitReaction(adapter, {
      postId: "post_123",
      visitorId,
      reaction: "love",
    });
    expect(deselected.counts).toEqual(counts());
    expect(deselected.selectedReaction).toBeNull();
    expect(await adapter.findSelection("post_123", visitorId)).toBeNull();
  });

  it("switches reaction by decrementing previous count and incrementing the new count", async () => {
    const adapter = new MemoryReactionAdapter();

    await submitReaction(
      adapter,
      {
        postId: "post_123",
        visitorId,
        reaction: "love",
      },
      { allowAggregateCreate: true },
    );
    const switched = await submitReaction(adapter, {
      postId: "post_123",
      visitorId,
      reaction: "thoughtProvoking",
    });

    expect(switched.counts).toEqual(counts({ thoughtProvoking: 1 }));
    expect((await adapter.findSelection("post_123", visitorId))?.reaction).toBe("thoughtProvoking");
  });

  it("prevents negative counts when clearing an existing low count", async () => {
    const adapter = new MemoryReactionAdapter();
    adapter.aggregates.set("post_123", {
      recordId: "agg_post_123",
      postId: "post_123",
      blogTitle: "Post Title",
      counts: counts(),
    });
    adapter.selections.set(`post_123:${visitorId}`, {
      recordId: "sel_1",
      postId: "post_123",
      visitorId,
      reaction: "confusing",
    });

    const cleared = await submitReaction(adapter, {
      postId: "post_123",
      visitorId,
      reaction: null,
    });

    expect(cleared.counts).toEqual(counts());
    expect(cleared.selectedReaction).toBeNull();
  });

  it("rejects invalid post ids, visitor ids, and reactions", async () => {
    const adapter = new MemoryReactionAdapter();

    await expect(
      submitReaction(adapter, {
        postId: "../secret",
        visitorId,
        reaction: "love",
      }),
    ).rejects.toThrow("Invalid post id.");

    await expect(
      submitReaction(adapter, {
        postId: "post_123",
        visitorId: "raw-ip-or-short-id",
        reaction: "love",
      }),
    ).rejects.toThrow("Invalid visitor id.");

    await expect(
      submitReaction(adapter, {
        postId: "post_123",
        visitorId,
        reaction: "wow" as ReactionKey,
      }),
    ).rejects.toThrow("Invalid reaction.");
  });

  it("returns structured setup-needed responses for missing aggregates over HTTP", async () => {
    const adapter = new MemoryReactionAdapter();

    const response = await handleReactionRequest(
      new Request(`https://example.test/.netlify/functions/blog-reactions?postId=post_123&visitorId=${visitorId}`),
      adapter,
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "missing_aggregate_record",
        message: "Reaction counts are not configured for this post yet.",
      },
    });
    expect(adapter.createAggregateCalls).toBe(0);
  });

  it("uses the lazy aggregate gate for HTTP reads with mocks only", async () => {
    process.env.REACTION_ENABLE_LAZY_AGGREGATE_UPSERT = "true";
    const adapter = new MemoryReactionAdapter();

    const response = await handleReactionRequest(
      new Request(`https://example.test/.netlify/functions/blog-reactions?postId=post_123&blogTitle=Post&visitorId=${visitorId}`),
      adapter,
    );
    const body = await response.json() as { counts: ReactionCounts };

    expect(response.status).toBe(200);
    expect(body.counts).toEqual(counts());
    expect(adapter.createAggregateCalls).toBe(1);
  });

  it("passes through structured Airtable permission and transient setup failures", async () => {
    const permissionAdapter = new MemoryReactionAdapter();
    permissionAdapter.findAggregateError = new ReactionSetupError(
      "airtable_permission_denied",
      "Reaction data is not available because the data source permissions are not configured.",
    );

    const permissionResponse = await handleReactionRequest(
      new Request(`https://example.test/.netlify/functions/blog-reactions?postId=post_123&visitorId=${visitorId}`),
      permissionAdapter,
    );
    expect(permissionResponse.status).toBe(503);
    await expect(permissionResponse.json()).resolves.toMatchObject({
      error: {
        code: "airtable_permission_denied",
      },
    });

    const transientAdapter = new MemoryReactionAdapter();
    transientAdapter.findAggregateError = new ReactionSetupError(
      "airtable_transient_failure",
      "Reaction data is temporarily unavailable.",
      502,
    );

    const transientResponse = await handleReactionRequest(
      new Request(`https://example.test/.netlify/functions/blog-reactions?postId=post_123&visitorId=${visitorId}`),
      transientAdapter,
    );
    expect(transientResponse.status).toBe(502);
    await expect(transientResponse.json()).resolves.toMatchObject({
      error: {
        code: "airtable_transient_failure",
      },
    });
  });
});

function counts(overrides: Partial<ReactionCounts> = {}): ReactionCounts {
  return {
    love: 0,
    confusing: 0,
    thoughtProvoking: 0,
    ...overrides,
  };
}

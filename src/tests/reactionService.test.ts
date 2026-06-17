import { describe, expect, it } from "vitest";
import { readReactionState, submitReaction } from "../reactions/reactionService.js";
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

  async findAggregateByPostId(postId: string): Promise<AggregateRecord | null> {
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
    const aggregate = [...this.aggregates.values()].find((item) => item.recordId === recordId);
    if (!aggregate) {
      throw new Error("missing aggregate");
    }
    aggregate.counts = { ...nextCounts };
    return aggregate;
  }

  async findSelection(postId: string, visitorId: string): Promise<SelectionRecord | null> {
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
  it("creates a missing aggregate when reading state", async () => {
    const adapter = new MemoryReactionAdapter();

    const state = await readReactionState(adapter, {
      postId: "post_123",
      blogTitle: "Post Title",
      visitorId,
    });

    expect(state.counts).toEqual(counts());
    expect(state.selectedReaction).toBeNull();
    expect(adapter.createAggregateCalls).toBe(1);
  });

  it("selects, deselects, and deletes visitor selection for the same reaction", async () => {
    const adapter = new MemoryReactionAdapter();

    const selected = await submitReaction(adapter, {
      postId: "post_123",
      blogTitle: "Post Title",
      visitorId,
      reaction: "love",
    });
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

    await submitReaction(adapter, {
      postId: "post_123",
      visitorId,
      reaction: "love",
    });
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
});

function counts(overrides: Partial<ReactionCounts> = {}): ReactionCounts {
  return {
    love: 0,
    confusing: 0,
    thoughtProvoking: 0,
    ...overrides,
  };
}

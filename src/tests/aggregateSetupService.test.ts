import { describe, expect, it } from "vitest";
import {
  type AggregateSetupAdapter,
  setupReactionAggregates,
} from "../reactions/aggregateSetupService.js";
import type { AggregateRecord } from "../reactions/types.js";

class MemoryAggregateSetupAdapter implements AggregateSetupAdapter {
  aggregates = new Map<string, AggregateRecord[]>();
  createCalls: Array<{ postId: string; blogTitle: string }> = [];

  async findAggregatesByPostId(postId: string): Promise<AggregateRecord[]> {
    return this.aggregates.get(postId) ?? [];
  }

  async createAggregate(postId: string, blogTitle: string): Promise<AggregateRecord> {
    this.createCalls.push({ postId, blogTitle });
    const record = aggregate(postId, blogTitle);
    this.aggregates.set(postId, [record]);
    return record;
  }
}

const publicPosts = [
  { id: "post_123", title: "Post One", link: "post-one" },
  { id: "post_456", title: "Post Two", link: "post-two" },
];

describe("aggregate setup service", () => {
  it("reports already-present aggregate rows without modifying counts", async () => {
    const adapter = new MemoryAggregateSetupAdapter();
    adapter.aggregates.set("post_123", [
      aggregate("post_123", "Post One", {
        love: 4,
        confusing: 1,
        thoughtProvoking: 2,
      }),
    ]);
    adapter.aggregates.set("post_456", [aggregate("post_456", "Post Two")]);

    const result = await setupReactionAggregates(adapter, publicPosts, "write");

    expect(result.presentRows).toBe(2);
    expect(result.createdRows).toBe(0);
    expect(adapter.createCalls).toEqual([]);
    expect(adapter.aggregates.get("post_123")?.[0]?.counts).toEqual({
      love: 4,
      confusing: 1,
      thoughtProvoking: 2,
    });
  });

  it("creates exactly one zero-count row for one missing public post in write mode", async () => {
    const adapter = new MemoryAggregateSetupAdapter();
    adapter.aggregates.set("post_123", [aggregate("post_123", "Post One")]);

    const result = await setupReactionAggregates(adapter, publicPosts, "write");

    expect(result.presentRows).toBe(1);
    expect(result.missingRows).toBe(1);
    expect(result.createdRows).toBe(1);
    expect(adapter.createCalls).toEqual([{ postId: "post_456", blogTitle: "Post Two" }]);
    expect(adapter.aggregates.get("post_456")?.[0]?.counts).toEqual({
      love: 0,
      confusing: 0,
      thoughtProvoking: 0,
    });
  });

  it("is idempotent across a second write run", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    const first = await setupReactionAggregates(adapter, publicPosts, "write");
    const second = await setupReactionAggregates(adapter, publicPosts, "write");

    expect(first.createdRows).toBe(2);
    expect(second.presentRows).toBe(2);
    expect(second.createdRows).toBe(0);
    expect(adapter.createCalls).toHaveLength(2);
  });

  it("does not create rows in dry-run mode", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    const result = await setupReactionAggregates(adapter, publicPosts, "dry-run");

    expect(result.plannedCreates).toBe(2);
    expect(result.createdRows).toBe(0);
    expect(adapter.createCalls).toEqual([]);
    expect(adapter.aggregates.size).toBe(0);
  });

  it("skips non-public posts when a rendered public post set includes draft flags", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    const result = await setupReactionAggregates(
      adapter,
      [
        ...publicPosts,
        { id: "post_draft", title: "Draft", link: "draft", draft: true },
        { id: "post_private", title: "Private", link: "private", public: false },
        { id: "post_hidden", title: "Hidden", link: "hidden", renderReactions: false },
      ],
      "write",
    );

    expect(result.inspectedPosts).toBe(5);
    expect(result.skippedNonPublicPosts).toBe(3);
    expect(result.createdRows).toBe(2);
    expect(adapter.createCalls).toEqual([
      { postId: "post_123", blogTitle: "Post One" },
      { postId: "post_456", blogTitle: "Post Two" },
    ]);
  });

  it("reports duplicate aggregate rows as blockers and does not write", async () => {
    const adapter = new MemoryAggregateSetupAdapter();
    adapter.aggregates.set("post_123", [
      aggregate("post_123", "Post One"),
      aggregate("post_123", "Post One", undefined, "agg_duplicate"),
    ]);

    const result = await setupReactionAggregates(adapter, publicPosts, "write");

    expect(result.duplicateRows).toBe(1);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({
        code: "duplicate_aggregate_records",
        postId: "post_123",
        existingRecordCount: 2,
      }),
    );
    expect(result.createdRows).toBe(0);
    expect(adapter.createCalls).toEqual([]);
  });

  it("reports missing titles as blockers and does not write", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    const result = await setupReactionAggregates(
      adapter,
      [{ id: "post_123", title: "", link: "untitled" }],
      "write",
    );

    expect(result.skippedInvalidPosts).toBe(1);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({
        code: "missing_blog_title",
        postId: "post_123",
      }),
    );
    expect(adapter.createCalls).toEqual([]);
  });

  it("reports invalid public post ids as blockers and does not fall back to slugs", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    const result = await setupReactionAggregates(
      adapter,
      [{ title: "Slug Only", link: "slug-only" }],
      "write",
    );

    expect(result.skippedInvalidPosts).toBe(1);
    expect(result.blockers).toContainEqual(
      expect.objectContaining({
        code: "invalid_public_post",
        slug: "slug-only",
      }),
    );
    expect(adapter.createCalls).toEqual([]);
  });
});

function aggregate(
  postId: string,
  blogTitle: string,
  counts = { love: 0, confusing: 0, thoughtProvoking: 0 },
  recordId = `agg_${postId}`,
): AggregateRecord {
  return {
    recordId,
    postId,
    blogTitle,
    counts,
  };
}

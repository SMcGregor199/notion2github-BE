import { describe, expect, it } from "vitest";
import {
  AUTO_SETUP_ENV,
  maybeSetupReactionAggregatesForBlogRefresh,
} from "../reactions/autoAggregateSetup.js";
import type { AggregateSetupAdapter } from "../reactions/aggregateSetupService.js";
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

const logger = {
  info: () => undefined,
  error: () => undefined,
};

describe("automatic reaction aggregate setup", () => {
  it("is disabled by default so ordinary imports/tests do not write", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    const result = await maybeSetupReactionAggregatesForBlogRefresh(
      [{ id: "post_123", title: "Post One", link: "post-one" }],
      { adapter, logger },
    );

    expect(result).toEqual({ enabled: false, reason: "disabled" });
    expect(adapter.createCalls).toEqual([]);
  });

  it("creates one missing aggregate row when explicitly enabled for a refreshed public post", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    const result = await maybeSetupReactionAggregatesForBlogRefresh(
      [{ id: "post_123", title: "Post One", link: "post-one" }],
      { enabled: true, adapter, logger },
    );

    expect(result.enabled).toBe(true);
    expect(result.enabled ? result.result.createdRows : 0).toBe(1);
    expect(adapter.createCalls).toEqual([{ postId: "post_123", blogTitle: "Post One" }]);
    expect(adapter.aggregates.get("post_123")?.[0]?.counts).toEqual({
      love: 0,
      confusing: 0,
      thoughtProvoking: 0,
    });
  });

  it("preserves existing aggregate counts when explicitly enabled", async () => {
    const adapter = new MemoryAggregateSetupAdapter();
    adapter.aggregates.set("post_123", [
      aggregate("post_123", "Post One", {
        love: 3,
        confusing: 1,
        thoughtProvoking: 5,
      }),
    ]);

    const result = await maybeSetupReactionAggregatesForBlogRefresh(
      [{ id: "post_123", title: "Post One", link: "post-one" }],
      { enabled: true, adapter, logger },
    );

    expect(result.enabled ? result.result.createdRows : -1).toBe(0);
    expect(adapter.createCalls).toEqual([]);
    expect(adapter.aggregates.get("post_123")?.[0]?.counts).toEqual({
      love: 3,
      confusing: 1,
      thoughtProvoking: 5,
    });
  });

  it("blocks on duplicate aggregate rows without creating missing rows", async () => {
    const adapter = new MemoryAggregateSetupAdapter();
    adapter.aggregates.set("post_123", [
      aggregate("post_123", "Post One", undefined, "agg_1"),
      aggregate("post_123", "Post One", undefined, "agg_2"),
    ]);

    await expect(
      maybeSetupReactionAggregatesForBlogRefresh(
        [
          { id: "post_123", title: "Post One", link: "post-one" },
          { id: "post_456", title: "Post Two", link: "post-two" },
        ],
        { enabled: true, adapter, logger },
      ),
    ).rejects.toMatchObject({
      code: "reaction_setup_unavailable",
      status: 503,
    });
    expect(adapter.createCalls).toEqual([]);
  });

  it("blocks safely on missing post title", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    await expect(
      maybeSetupReactionAggregatesForBlogRefresh(
        [{ id: "post_123", title: "", link: "post-one" }],
        { enabled: true, adapter, logger },
      ),
    ).rejects.toMatchObject({
      code: "reaction_setup_unavailable",
    });
    expect(adapter.createCalls).toEqual([]);
  });

  it("skips posts that are marked not public or not reaction-rendered", async () => {
    const adapter = new MemoryAggregateSetupAdapter();

    const result = await maybeSetupReactionAggregatesForBlogRefresh(
      [
        { id: "post_123", title: "Post One", link: "post-one" },
        { id: "post_draft", title: "Draft", link: "draft", draft: true },
        { id: "post_private", title: "Private", link: "private", public: false },
        { id: "post_hidden", title: "Hidden", link: "hidden", renderReactions: false },
      ],
      { enabled: true, adapter, logger },
    );

    expect(result.enabled ? result.result.skippedNonPublicPosts : -1).toBe(3);
    expect(adapter.createCalls).toEqual([{ postId: "post_123", blogTitle: "Post One" }]);
  });

  it("uses the explicit non-secret environment flag", async () => {
    expect(AUTO_SETUP_ENV).toBe("REACTION_AUTO_SETUP_ON_BLOG_REFRESH");
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

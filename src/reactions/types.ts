export type ReactionKey = "love" | "confusing" | "thoughtProvoking";

export type ReactionCounts = Record<ReactionKey, number>;

export type SelectedReaction = ReactionKey | null;

export type AggregateRecord = {
  recordId: string;
  postId: string;
  blogTitle: string;
  counts: ReactionCounts;
};

export type SelectionRecord = {
  recordId: string;
  postId: string;
  visitorId: string;
  reaction: ReactionKey;
};

export type ReactionState = {
  postId: string;
  counts: ReactionCounts;
  selectedReaction: SelectedReaction;
};

export type ReactionAdapter = {
  findAggregateByPostId(postId: string): Promise<AggregateRecord | null>;
  createAggregate(postId: string, blogTitle: string): Promise<AggregateRecord>;
  updateAggregateCounts(recordId: string, counts: ReactionCounts): Promise<AggregateRecord>;
  findSelection(postId: string, visitorId: string): Promise<SelectionRecord | null>;
  createSelection(postId: string, visitorId: string, reaction: ReactionKey): Promise<SelectionRecord>;
  updateSelection(recordId: string, reaction: ReactionKey): Promise<SelectionRecord>;
  deleteSelection(recordId: string): Promise<void>;
};

export type ReactionRequest = {
  postId: string;
  blogTitle?: string;
  visitorId?: string;
  reaction?: ReactionKey | null;
};

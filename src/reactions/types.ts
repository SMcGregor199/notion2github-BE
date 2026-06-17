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

export type ReactionErrorCode =
  | "airtable_permission_denied"
  | "airtable_transient_failure"
  | "invalid_post_id"
  | "invalid_reaction"
  | "invalid_request"
  | "invalid_visitor_id"
  | "missing_aggregate_record"
  | "missing_aggregate_field"
  | "missing_aggregate_table"
  | "missing_env_var"
  | "missing_selection_field"
  | "missing_selection_table"
  | "reaction_setup_unavailable";

export type ReactionErrorBody = {
  error: {
    code: ReactionErrorCode;
    message: string;
  };
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

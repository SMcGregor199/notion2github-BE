import Airtable from "airtable";
import getEnvValue from "../utils/getEnvValue.js";
import {
  REACTION_FIELDS,
  emptyReactionCounts,
  isReactionKey,
  normalizeCounts,
} from "./reactionService.js";
import type {
  AggregateRecord,
  ReactionAdapter,
  ReactionCounts,
  ReactionKey,
  SelectionRecord,
} from "./types.js";

type AirtableRecordLike = {
  id: string;
  get(fieldName: string): unknown;
};

type AirtableTableLike = {
  select(options: { filterByFormula: string; maxRecords: number; pageSize: number }): {
    firstPage(): Promise<AirtableRecordLike[]>;
  };
  create(records: Array<{ fields: Record<string, string | number> }>): Promise<AirtableRecordLike[]>;
  update(records: Array<{ id: string; fields: Record<string, string | number> }>): Promise<AirtableRecordLike[]>;
  destroy(recordIds: string[]): Promise<unknown>;
};

type AirtableBase = (tableName: string) => AirtableTableLike;

const AGGREGATE_TABLE = "Blog Posts";
const SELECTION_TABLE = process.env.AIRTABLE_REACTION_SELECTIONS_TABLE || "Blog Post Reaction Selections";

const SELECTION_FIELDS = {
  key: "Key",
  postId: "Post Id",
  visitorId: "Visitor Id",
  reaction: "Reaction",
} as const;

export function createAirtableReactionAdapter(): ReactionAdapter {
  const base = new Airtable({ apiKey: getEnvValue("AIRTABLE_API_KEY") }).base(
    getEnvValue("AIRTABLE_BASE_ID"),
  ) as unknown as AirtableBase;
  return createAirtableReactionAdapterFromBase(base);
}

export function createAirtableReactionAdapterFromBase(base: AirtableBase): ReactionAdapter {
  return {
    async findAggregateByPostId(postId: string): Promise<AggregateRecord | null> {
      const records = await selectFirstPage(base, AGGREGATE_TABLE, `{Id} = ${quoteFormula(postId)}`);
      const record = records[0];
      return record ? aggregateFromRecord(record) : null;
    },

    async createAggregate(postId: string, blogTitle: string): Promise<AggregateRecord> {
      const records = await base(AGGREGATE_TABLE).create([
        {
          fields: {
            Id: postId,
            "Blog Title": blogTitle,
            Loved: 0,
            Confused: 0,
            "Thought Provoking": 0,
          },
        },
      ]);
      return aggregateFromRecord(records[0]);
    },

    async updateAggregateCounts(recordId: string, counts: ReactionCounts): Promise<AggregateRecord> {
      const safeCounts = normalizeCounts(counts);
      const records = await base(AGGREGATE_TABLE).update([
        {
          id: recordId,
          fields: {
            Loved: safeCounts.love,
            Confused: safeCounts.confusing,
            "Thought Provoking": safeCounts.thoughtProvoking,
          },
        },
      ]);
      return aggregateFromRecord(records[0]);
    },

    async findSelection(postId: string, visitorId: string): Promise<SelectionRecord | null> {
      const key = selectionKey(postId, visitorId);
      const records = await selectFirstPage(
        base,
        SELECTION_TABLE,
        `{${SELECTION_FIELDS.key}} = ${quoteFormula(key)}`,
      );
      const record = records[0];
      return record ? selectionFromRecord(record) : null;
    },

    async createSelection(
      postId: string,
      visitorId: string,
      reaction: ReactionKey,
    ): Promise<SelectionRecord> {
      const records = await base(SELECTION_TABLE).create([
        {
          fields: {
            [SELECTION_FIELDS.key]: selectionKey(postId, visitorId),
            [SELECTION_FIELDS.postId]: postId,
            [SELECTION_FIELDS.visitorId]: visitorId,
            [SELECTION_FIELDS.reaction]: reaction,
          },
        },
      ]);
      return selectionFromRecord(records[0]);
    },

    async updateSelection(recordId: string, reaction: ReactionKey): Promise<SelectionRecord> {
      const records = await base(SELECTION_TABLE).update([
        {
          id: recordId,
          fields: {
            [SELECTION_FIELDS.reaction]: reaction,
          },
        },
      ]);
      return selectionFromRecord(records[0]);
    },

    async deleteSelection(recordId: string): Promise<void> {
      await base(SELECTION_TABLE).destroy([recordId]);
    },
  };
}

function aggregateFromRecord(record: AirtableRecordLike): AggregateRecord {
  return {
    recordId: record.id,
    postId: String(record.get("Id") ?? ""),
    blogTitle: String(record.get("Blog Title") ?? ""),
    counts: {
      love: toCount(record.get(REACTION_FIELDS.love)),
      confusing: toCount(record.get(REACTION_FIELDS.confusing)),
      thoughtProvoking: toCount(record.get(REACTION_FIELDS.thoughtProvoking)),
    },
  };
}

function selectionFromRecord(record: AirtableRecordLike): SelectionRecord {
  const reaction = record.get(SELECTION_FIELDS.reaction);
  if (!isReactionKey(reaction)) {
    throw new Error("Airtable selection record has an invalid reaction.");
  }
  return {
    recordId: record.id,
    postId: String(record.get(SELECTION_FIELDS.postId) ?? ""),
    visitorId: String(record.get(SELECTION_FIELDS.visitorId) ?? ""),
    reaction,
  };
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function quoteFormula(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function selectionKey(postId: string, visitorId: string): string {
  return `${postId}:${visitorId}`;
}

async function selectFirstPage(
  base: AirtableBase,
  tableName: string,
  filterByFormula: string,
): Promise<AirtableRecordLike[]> {
  return base(tableName)
    .select({
      filterByFormula,
      maxRecords: 1,
      pageSize: 1,
    })
    .firstPage();
}

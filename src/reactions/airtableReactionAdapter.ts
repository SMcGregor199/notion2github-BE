import Airtable from "airtable";
import getEnvValue from "../utils/getEnvValue.js";
import {
  REACTION_FIELDS,
  isReactionKey,
  normalizeCounts,
  ReactionSetupError,
} from "./reactionService.js";
import type {
  AggregateRecord,
  ReactionAdapter,
  ReactionCounts,
  ReactionErrorCode,
  ReactionKey,
  SelectionRecord,
} from "./types.js";
import type { AggregateSetupAdapter } from "./aggregateSetupService.js";

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
  const base = new Airtable({ apiKey: readRequiredEnv("AIRTABLE_API_KEY") }).base(
    readRequiredEnv("AIRTABLE_BASE_ID"),
  ) as unknown as AirtableBase;
  return createAirtableReactionAdapterFromBase(base);
}

export function createAirtableReactionAdapterFromBase(base: AirtableBase): ReactionAdapter {
  return {
    async findAggregateByPostId(postId: string): Promise<AggregateRecord | null> {
      const records = await withAirtableSetupErrors(
        "find_aggregate",
        "aggregate",
        () => selectFirstPage(base, AGGREGATE_TABLE, `{Id} = ${quoteFormula(postId)}`),
      );
      const record = records[0];
      return record ? aggregateFromRecord(record) : null;
    },

    async createAggregate(postId: string, blogTitle: string): Promise<AggregateRecord> {
      const records = await withAirtableSetupErrors(
        "create_aggregate",
        "aggregate",
        () =>
          base(AGGREGATE_TABLE).create([
            {
              fields: {
                Id: postId,
                "Blog Title": blogTitle,
                Loved: 0,
                Confused: 0,
                "Thought Provoking": 0,
              },
            },
          ]),
      );
      const record = records[0];
      if (!record) {
        throw new ReactionSetupError("airtable_transient_failure", "Airtable did not return the created record.", 502);
      }
      return aggregateFromRecord(record);
    },

    async updateAggregateCounts(recordId: string, counts: ReactionCounts): Promise<AggregateRecord> {
      const safeCounts = normalizeCounts(counts);
      const records = await withAirtableSetupErrors(
        "update_aggregate",
        "aggregate",
        () =>
          base(AGGREGATE_TABLE).update([
            {
              id: recordId,
              fields: {
                Loved: safeCounts.love,
                Confused: safeCounts.confusing,
                "Thought Provoking": safeCounts.thoughtProvoking,
              },
            },
          ]),
      );
      const record = records[0];
      if (!record) {
        throw new ReactionSetupError("airtable_transient_failure", "Airtable did not return the updated record.", 502);
      }
      return aggregateFromRecord(record);
    },

    async findSelection(postId: string, visitorId: string): Promise<SelectionRecord | null> {
      const key = selectionKey(postId, visitorId);
      const records = await withAirtableSetupErrors(
        "find_selection",
        "selection",
        () =>
          selectFirstPage(
            base,
            SELECTION_TABLE,
            `{${SELECTION_FIELDS.key}} = ${quoteFormula(key)}`,
          ),
      );
      const record = records[0];
      return record ? selectionFromRecord(record) : null;
    },

    async createSelection(
      postId: string,
      visitorId: string,
      reaction: ReactionKey,
    ): Promise<SelectionRecord> {
      const records = await withAirtableSetupErrors(
        "create_selection",
        "selection",
        () =>
          base(SELECTION_TABLE).create([
            {
              fields: {
                [SELECTION_FIELDS.key]: selectionKey(postId, visitorId),
                [SELECTION_FIELDS.postId]: postId,
                [SELECTION_FIELDS.visitorId]: visitorId,
                [SELECTION_FIELDS.reaction]: reaction,
              },
            },
          ]),
      );
      const record = records[0];
      if (!record) {
        throw new ReactionSetupError("airtable_transient_failure", "Airtable did not return the created record.", 502);
      }
      return selectionFromRecord(record);
    },

    async updateSelection(recordId: string, reaction: ReactionKey): Promise<SelectionRecord> {
      const records = await withAirtableSetupErrors(
        "update_selection",
        "selection",
        () =>
          base(SELECTION_TABLE).update([
            {
              id: recordId,
              fields: {
                [SELECTION_FIELDS.reaction]: reaction,
              },
            },
          ]),
      );
      const record = records[0];
      if (!record) {
        throw new ReactionSetupError("airtable_transient_failure", "Airtable did not return the updated record.", 502);
      }
      return selectionFromRecord(record);
    },

    async deleteSelection(recordId: string): Promise<void> {
      await withAirtableSetupErrors(
        "delete_selection",
        "selection",
        () => base(SELECTION_TABLE).destroy([recordId]),
      );
    },
  };
}

export function createAirtableAggregateSetupAdapter(): AggregateSetupAdapter {
  const base = new Airtable({ apiKey: readRequiredEnv("AIRTABLE_API_KEY") }).base(
    readRequiredEnv("AIRTABLE_BASE_ID"),
  ) as unknown as AirtableBase;
  return createAirtableAggregateSetupAdapterFromBase(base);
}

export function createAirtableAggregateSetupAdapterFromBase(base: AirtableBase): AggregateSetupAdapter {
  return {
    async verifyAggregateSetup(): Promise<void> {
      await withAirtableSetupErrors(
        "verify_aggregate_setup",
        "aggregate",
        () => selectFirstPage(base, AGGREGATE_TABLE, `{Id} != ''`, 1),
      );
    },

    async findAggregatesByPostId(postId: string): Promise<AggregateRecord[]> {
      const records = await withAirtableSetupErrors(
        "find_aggregates_for_setup",
        "aggregate",
        () => selectFirstPage(base, AGGREGATE_TABLE, `{Id} = ${quoteFormula(postId)}`, 100),
      );
      return records.map((record) => aggregateFromRecord(record));
    },

    async createAggregate(postId: string, blogTitle: string): Promise<AggregateRecord> {
      const reactionAdapter = createAirtableReactionAdapterFromBase(base);
      return reactionAdapter.createAggregate(postId, blogTitle);
    },
  };
}

function readRequiredEnv(name: string): string {
  try {
    return getEnvValue(name);
  } catch {
    throw new ReactionSetupError("missing_env_var", `Required reaction service configuration is missing: ${name}.`);
  }
}

async function withAirtableSetupErrors<T>(
  operation: string,
  tableKind: "aggregate" | "selection",
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (err) {
    throw mapAirtableError(err, operation, tableKind);
  }
}

function mapAirtableError(
  err: unknown,
  operation: string,
  tableKind: "aggregate" | "selection",
): ReactionSetupError {
  if (err instanceof ReactionSetupError) {
    return err;
  }

  const status = typeof (err as { statusCode?: unknown })?.statusCode === "number"
    ? (err as { statusCode: number }).statusCode
    : typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : undefined;
  const rawMessage = String((err as { message?: unknown })?.message ?? err ?? "");
  const message = rawMessage.toLowerCase();

  let code: ReactionErrorCode = "airtable_transient_failure";
  let clientMessage = "Reaction data is temporarily unavailable.";
  let responseStatus = status && status >= 500 ? 502 : 503;

  if (status === 401 || status === 403 || message.includes("permission") || message.includes("unauthorized")) {
    code = "airtable_permission_denied";
    clientMessage = "Reaction data is not available because the data source permissions are not configured.";
  } else if (message.includes("unknown field") || message.includes("field")) {
    code = tableKind === "aggregate" ? "missing_aggregate_field" : "missing_selection_field";
    clientMessage = "Reaction data is not available because the data source fields are not configured.";
  } else if (message.includes("table") || message.includes("not found")) {
    code = tableKind === "aggregate" ? "missing_aggregate_table" : "missing_selection_table";
    clientMessage = "Reaction data is not available because the data source table is not configured.";
  } else if (status === 429 || status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
    responseStatus = 502;
  }

  console.error("Reaction Airtable setup error", {
    operation,
    code,
    status: status ?? "unknown",
  });
  return new ReactionSetupError(code, clientMessage, responseStatus);
}

function aggregateFromRecord(record: AirtableRecordLike): AggregateRecord {
  try {
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
  } catch {
    throw new ReactionSetupError(
      "missing_aggregate_field",
      "Reaction data is not available because the data source fields are not configured.",
    );
  }
}

function selectionFromRecord(record: AirtableRecordLike): SelectionRecord {
  try {
    const reaction = record.get(SELECTION_FIELDS.reaction);
    if (!isReactionKey(reaction)) {
      throw new ReactionSetupError(
        "missing_selection_field",
        "Reaction data is not available because a stored selection is invalid.",
      );
    }
    return {
      recordId: record.id,
      postId: String(record.get(SELECTION_FIELDS.postId) ?? ""),
      visitorId: String(record.get(SELECTION_FIELDS.visitorId) ?? ""),
      reaction,
    };
  } catch (err) {
    if (err instanceof ReactionSetupError) {
      throw err;
    }
    throw new ReactionSetupError(
      "missing_selection_field",
      "Reaction data is not available because the data source fields are not configured.",
    );
  }
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
  maxRecords = 1,
): Promise<AirtableRecordLike[]> {
  return base(tableName)
    .select({
      filterByFormula,
      maxRecords,
      pageSize: Math.min(maxRecords, 100),
    })
    .firstPage();
}

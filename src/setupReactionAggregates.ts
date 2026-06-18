import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createAirtableAggregateSetupAdapter } from "./reactions/airtableReactionAdapter.js";
import {
  type AggregateSetupMode,
  setupReactionAggregates,
} from "./reactions/aggregateSetupService.js";

type BlogDataModule = {
  blogPostsData?: unknown;
  default?: unknown;
};

type CliOptions = {
  mode: AggregateSetupMode;
  source: string;
};

const DEFAULT_SOURCE = "data/notionBlogData.js";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const posts = await loadPublicPosts(options.source);
  const adapter = createAirtableAggregateSetupAdapter();
  const result = await setupReactionAggregates(adapter, posts, options.mode);

  console.log(JSON.stringify(safeSummary(result), null, 2));

  if (result.blockers.length > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): CliOptions {
  let mode: AggregateSetupMode = "dry-run";
  let source = process.env.REACTION_BLOG_DATA_SOURCE || DEFAULT_SOURCE;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run" || arg === "--report") {
      mode = "dry-run";
    } else if (arg === "--write") {
      mode = "write";
    } else if (arg === "--source") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("--source requires a file path or URL.");
      }
      source = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { mode, source };
}

async function loadPublicPosts(source: string): Promise<Array<Record<string, unknown>>> {
  const data = source.startsWith("http://") || source.startsWith("https://")
    ? await loadRemoteData(source)
    : await loadLocalData(source);

  if (!Array.isArray(data)) {
    throw new Error("Reaction aggregate setup source must provide an array of public posts.");
  }
  return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

async function loadRemoteData(source: string): Promise<unknown> {
  const response = await fetch(source, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load public post data: HTTP ${response.status}.`);
  }
  return response.json();
}

async function loadLocalData(source: string): Promise<unknown> {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), source)).href;
  const imported = await import(moduleUrl) as BlogDataModule;
  return imported.blogPostsData ?? imported.default;
}

function safeSummary(result: Awaited<ReturnType<typeof setupReactionAggregates>>): unknown {
  return {
    mode: result.mode,
    inspectedPosts: result.inspectedPosts,
    presentRows: result.presentRows,
    missingRows: result.missingRows,
    plannedCreates: result.plannedCreates,
    createdRows: result.createdRows,
    duplicateRows: result.duplicateRows,
    skippedNonPublicPosts: result.skippedNonPublicPosts,
    skippedInvalidPosts: result.skippedInvalidPosts,
    blockers: result.blockers,
    posts: result.posts.map((post) => ({
      postId: post.postId,
      blogTitle: post.blogTitle,
      slug: post.slug,
      status: post.status,
      existingRecordCount: post.existingRecordCount,
    })),
  };
}

main().catch((err: unknown) => {
  console.error("Reaction aggregate setup failed", {
    errorType: err instanceof Error ? err.name : typeof err,
    message: err instanceof Error ? err.message : "Unknown error",
  });
  process.exitCode = 1;
});

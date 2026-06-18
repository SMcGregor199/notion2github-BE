import { createAirtableAggregateSetupAdapter } from "./airtableReactionAdapter.js";
import {
  type AggregateSetupAdapter,
  type AggregateSetupResult,
  type PublicBlogPostInput,
  setupReactionAggregates,
} from "./aggregateSetupService.js";
import { ReactionSetupError } from "./reactionService.js";

export const AUTO_SETUP_ENV = "REACTION_AUTO_SETUP_ON_BLOG_REFRESH";

export type AutoAggregateSetupResult =
  | {
      enabled: false;
      reason: "disabled";
    }
  | {
      enabled: true;
      result: AggregateSetupResult;
    };

export type AutoAggregateSetupOptions = {
  enabled?: boolean;
  adapter?: AggregateSetupAdapter;
  logger?: Pick<Console, "info" | "error">;
};

export async function maybeSetupReactionAggregatesForBlogRefresh(
  publicPosts: PublicBlogPostInput[] | undefined,
  options: AutoAggregateSetupOptions = {},
): Promise<AutoAggregateSetupResult> {
  const logger = options.logger ?? console;
  const enabled = options.enabled ?? isAutoAggregateSetupEnabled();

  if (!enabled) {
    logger.info("Reaction aggregate auto-setup skipped", {
      reason: "disabled",
      env: AUTO_SETUP_ENV,
    });
    return {
      enabled: false,
      reason: "disabled",
    };
  }

  const posts = Array.isArray(publicPosts) ? publicPosts : [];
  const adapter = options.adapter ?? createAirtableAggregateSetupAdapter();
  const result = await setupReactionAggregates(adapter, posts, "write");

  logger.info("Reaction aggregate auto-setup finished", {
    inspectedPosts: result.inspectedPosts,
    presentRows: result.presentRows,
    missingRows: result.missingRows,
    createdRows: result.createdRows,
    duplicateRows: result.duplicateRows,
    skippedNonPublicPosts: result.skippedNonPublicPosts,
    skippedInvalidPosts: result.skippedInvalidPosts,
    blockerCount: result.blockers.length,
  });

  if (result.blockers.length > 0) {
    logger.error("Reaction aggregate auto-setup blocked", {
      blockerCodes: result.blockers.map((blocker) => blocker.code),
      blockerCount: result.blockers.length,
    });
    throw new ReactionSetupError(
      "reaction_setup_unavailable",
      "Reaction aggregate auto-setup found blockers.",
      503,
    );
  }

  return {
    enabled: true,
    result,
  };
}

export function isAutoAggregateSetupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AUTO_SETUP_ENV] === "true";
}

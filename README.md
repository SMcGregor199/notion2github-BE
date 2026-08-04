# notion2github-BE

Node/TypeScript backend and Netlify Functions layer for `shaynemcgregor.dev`.

## Production Releases

This Netlify site shares one production-deploy budget with the frontend and every other Personal-team site. Use feature PRs and review their Deploy Previews; merge only planned release batches into `main`. The single counter and complete checklist live in the frontend repository's [Netlify release guide](https://github.com/SMcGregor199/notion2github-FE/blob/main/NETLIFY_RELEASE_GUIDE.md).

## What This Repo Does

- Reads Notion child pages.
- Normalizes Notion content into shared blog JSON.
- Serves blog JSON through Netlify Functions.
- Optimizes Notion page images with Sharp and caches them in Netlify Blobs.
- Provides an Airtable seed flow for blog reaction records.
- Provides an RSS auto-update path for refreshed blog data when production RSS env configuration enables it.
- Provides a deployed RSS feed function that serves the configured generated RSS Blob.
- Provides a sitemap function that reads the current published-post Blob manifest without refreshing content.
- Generates six reviewable LinkedIn/Substack social drafts in Notion without publishing or scheduling them.

## Commands

- `npm run dev`: run `tsx src/index.ts`.
- `npm run build`: compile TypeScript.
- `npm run test`: run Vitest.
- `npm run dev:server`: run the Express server stub.
- `npm run start`: run `dist/index.js`.
- `npm run start:server`: run `dist/server/index.js`.
- `npm run seed:airtable`: seed Airtable records. Approval required.
- `npm run clean`: remove `dist/`.

For the one-time Notion database button and automation configuration, see [docs/notion-cms-automation.md](docs/notion-cms-automation.md).

## Local Development Notes

- This repo is clearly Netlify-configured through `netlify.toml`, `netlify/functions/`, and `@netlify/*` dependencies.
- It is the upstream source hub for the shared blog contract.
- The backend contract should be treated as the primary interface for the frontend and RSS generator.
- When `NOTION_DATABASE_ID` is configured, blog posts are read from a Notion database/data source instead of child pages under `NOTION_PAGE_ID`. This value may be either the database ID or a `collection://...` data source ID.
- The Resource Guide is a separate Notion data source served from `resource-guide-data`; it uses private `NOTION_RESOURCES_DATABASE_ID`, its own `resources` Blob store, and never refreshes blog content, RSS, or CMS state. See the root [Resource Guide specification](../docs/features/ai-research-resource-guide.md) for the required Notion schema, publication rules, cache configuration, and public/private note boundary.
- The Notion CMS database uses `Name`, `Published`, `Tag`, `Summary`, `Slug`, `Feature Image`, `Publication Date`, and an optional single-value `Series` relation. Only posts with `Published` checked are returned publicly.
- Series are authored in a separate `Blog Series` data source with `Name`, stable `Slug`, optional `Description`, and its reciprocal `Posts` relation. Set private `NOTION_BLOG_SERIES_DATABASE_ID` to that data source ID. Public posts receive optional `{ name, slug, description? }` series metadata; missing or unavailable series configuration leaves posts public without series metadata.
- CMS authoring adds a computed `Status`, `CMS Record ID`, metadata and social-draft state/error fields, and separate `Generate Post Assets` and `Generate Social Drafts` buttons. `Published` remains the publication source of truth; Notion calculates `Status` from it.
- `cms-notion-webhook` receives signed Notion connection events, so Free-plan database buttons can queue metadata generation and `Published` toggles can sync public blog/RSS data. The paid-plan `cms-generate` and `cms-publish-sync` automation endpoints remain supported.
- The same connection webhook can queue social-copy generation through `Social Draft State`. The backend writes six editable pages to the private `Social Post Drafts` data source, uses only its `Published` rows as voice references, and refuses to replace non-superseded rows.
- Blog subscriptions use a private Notion `Blog Subscribers` data source as the CRM. Resend is a delivery mirror for double opt-in confirmation emails, subscribed contacts, broadcasts, hosted unsubscription, and signed delivery webhooks. See `docs/notion-cms-automation.md` for the required Notion schema, Resend/DNS activation checklist, and newsletter button workflow.
- The CMS webhook environment variables are `NOTION_WEBHOOK_VERIFICATION_TOKEN`, `CMS_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `CMS_TEXT_MODEL`, `CMS_IMAGE_MODEL`, `CMS_IMAGE_QUALITY`, and `NOTION_SOCIAL_POSTS_DATABASE_ID`. The default image model is `gpt-image-2` at high quality.
- Database-backed posts expose Markdown body content as `bodyMarkdown`; legacy child-page mode still includes the older nested `body` structure for compatibility.
- Notion file/media feature images and page covers are registered in Netlify Blobs and served through `netlify/functions/notion-image`.
- RSS auto-update is gated by `RSS_AUTO_UPDATE_ON_BLOG_REFRESH`; production activation currently uses `true` for the approved RSS function context.
- Non-secret RSS configuration names are `RSS_AUTO_UPDATE_ON_BLOG_REFRESH`, `RSS_PUBLIC_URL`, `RSS_SITE_BASE_URL`, `RSS_OUTPUT_STORE`, `RSS_OUTPUT_KEY`, and `RSS_PREVIOUS_CONTENT_HASH_KEY`.
- RSS update failures are non-blocking for blog JSON refreshes and preserve the last known good RSS output.
- The recommended RSS output target names are store `content`, RSS key `rss.xml`, and marker key `content/rss-manifest.json`.
- `netlify/functions/rss-feed.ts` serves the configured RSS Blob with `application/rss+xml; charset=utf-8`.
- Public `/rss.xml` is routed from the frontend site to the generated backend feed after the approved production activation.
- `netlify/functions/sitemap-posts.ts` serves current published post URLs from `content/manifest.json`; the frontend proxies public `/sitemap-posts.xml` to it. Notion publications therefore appear in the post sitemap after the normal content refresh, without a frontend deployment.

## Artifact And Generated File Cautions

- `dist/` is currently untracked and should be treated as generated output unless proven otherwise.
- Prefer `npm run clean` when you want to remove compiled output.
- Do not run the Airtable seed flow unless the write action is explicitly approved.
- Do not assume blob-writing or deploy-like flows are safe just because they are available in the repo.
- Do not enable RSS production writes, write RSS blobs, change Netlify routing, or deploy without explicit approval.

## Relation To The Other Repos

- Produces the blog JSON consumed by `notion2github-FE`.
- Produces the image URLs consumed by `notion2github-FE` and `xml-feed-gen`.
- Provides the backend endpoint consumed by `xml-feed-gen`.
- Owns the shared blog data contract that downstream repos should follow.
- Owns the RSS publish trigger that can use refreshed in-memory blog posts and content hashes without calling the public refresh endpoint.
- Owns the backend RSS serving function for the generated Blob-backed feed.

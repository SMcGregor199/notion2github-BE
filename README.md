# notion2github-BE

Node/TypeScript backend and Netlify Functions layer for `shaynemcgregor.dev`.

## What This Repo Does

- Reads Notion child pages.
- Normalizes Notion content into shared blog JSON.
- Serves blog JSON through Netlify Functions.
- Optimizes Notion page images with Sharp and caches them in Netlify Blobs.
- Provides an Airtable seed flow for blog reaction records.
- Provides an RSS auto-update path for refreshed blog data when production RSS env configuration enables it.
- Provides a deployed RSS feed function that serves the configured generated RSS Blob.

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
- The Notion CMS database uses `Name`, `Published`, `Tag`, `Summary`, `Slug`, `Feature Image`, and `Publication Date` properties. Only posts with `Published` checked are returned publicly.
- CMS authoring adds `Status`, `CMS Record ID`, `Metadata State`, `Metadata Error`, and a `Generate Metadata` button. `Published` remains the publication source of truth; `cms-publish-sync` derives the `Status` tag from it.
- `cms-generate` receives an authenticated Notion automation webhook, generates initial tag/summary/slug/feature image metadata, and uploads the generated image into Notion's `Feature Image` property. `cms-publish-sync` records the first publication timestamp and refreshes the public JSON/RSS data after any publication toggle.
- The CMS webhook environment variables are `CMS_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `CMS_TEXT_MODEL`, `CMS_IMAGE_MODEL`, and `CMS_IMAGE_QUALITY`. The default image model is `gpt-image-2` at high quality.
- Database-backed posts expose Markdown body content as `bodyMarkdown`; legacy child-page mode still includes the older nested `body` structure for compatibility.
- Notion file/media feature images and page covers are registered in Netlify Blobs and served through `netlify/functions/notion-image`.
- RSS auto-update is gated by `RSS_AUTO_UPDATE_ON_BLOG_REFRESH`; production activation currently uses `true` for the approved RSS function context.
- Non-secret RSS configuration names are `RSS_AUTO_UPDATE_ON_BLOG_REFRESH`, `RSS_PUBLIC_URL`, `RSS_SITE_BASE_URL`, `RSS_OUTPUT_STORE`, `RSS_OUTPUT_KEY`, and `RSS_PREVIOUS_CONTENT_HASH_KEY`.
- RSS update failures are non-blocking for blog JSON refreshes and preserve the last known good RSS output.
- The recommended RSS output target names are store `content`, RSS key `rss.xml`, and marker key `content/rss-manifest.json`.
- `netlify/functions/rss-feed.ts` serves the configured RSS Blob with `application/rss+xml; charset=utf-8`.
- Public `/rss.xml` is routed from the frontend site to the generated backend feed after the approved production activation.

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

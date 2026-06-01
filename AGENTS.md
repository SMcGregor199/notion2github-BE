# Agent Instructions for notion2github-BE

This repo is the Node/TypeScript backend and Netlify Functions layer for `shaynemcgregor.dev`.

Read the parent workspace `system_context.md` before making cross-repo or data-contract changes.

## Repo Purpose

- Read blog content from Notion.
- Normalize Notion child pages into blog post JSON.
- Serve blog JSON through Netlify Functions.
- Optimize Notion page images with Sharp.
- Cache content and images in Netlify Blobs.
- Seed Airtable blog reaction records when explicitly approved.

## Important Directories And Files

- `src/index.ts`: Notion-to-Airtable seed entry point.
- `src/getBlogPostIds.ts`: reads Notion child block IDs.
- `src/getBlogPostTitles.ts`: reads Notion child page titles.
- `src/createAirtableRecordsArray.ts`: builds Airtable seed records.
- `src/seedAirtableWithBlogPostReacData.ts`: writes Airtable records.
- `src/utils/getEnvValue.ts`: reads required environment variables.
- `src/utils/types/`: shared TypeScript interfaces.
- `src/tests/`: Vitest tests.
- `src/server/index.ts`: small Express server stub.
- `utils/helper.js`: maps Notion pages into blog post data.
- `utils/fetchAndStoreLatestData.js`: writes content and manifest data to Netlify Blobs.
- `netlify/functions/notion-blog-data.js`: refreshes and serves blog data.
- `netlify/functions/blog-posts-json.ts`: serves stored blog JSON for RSS.
- `netlify/functions/notion-image.js`: optimizes and caches Notion images.
- `netlify.toml`: Netlify build/function config.
- `tsconfig.json`: TypeScript config for `src`.
- `vitest.config.ts`: Vitest config.
- `.gitignore`: ignore rules. Do not add `AGENTS.md`.

## Relevant Commands

- `npm run build`: compile TypeScript.
- `npm run test`: run Vitest.
- `npm run dev`: run the seed entry point with `tsx src/index.ts`.
- `npm run dev:server`: run the Express server stub.
- `npm run start`: run compiled `dist/index.js`.
- `npm run start:server`: run compiled server.
- `npm run seed:airtable`: seed Airtable records. Approval required.
- `npm run clean`: remove `dist`.

## External Services Used

- Notion: source blog pages and source images.
- Netlify Functions: public backend endpoints.
- Netlify Blobs: content and image storage/cache.
- Airtable: blog reaction record storage/seeding.
- GitHub: repo hosting and future PR workflow.

## Connections To Other Repos

- Produces live blog JSON consumed by `notion2github-FE`.
- Produces optimized image URLs consumed by `notion2github-FE` and `xml-feed-gen`.
- Provides `blog-posts-json` consumed by `xml-feed-gen`.
- Owns the source contract shared by the frontend and RSS generator.

## Inspect Before Changing

- `git status --short`
- `.gitignore`
- `.git/info/exclude`
- `package.json`
- `netlify.toml`
- `tsconfig.json`
- `vitest.config.ts`
- relevant files under `src/`, `utils/`, and `netlify/functions/`
- parent `../system_context.md` for cross-repo contract context

Do not inspect `.env` files, `.netlify/state.json`, or secret files.

## Do Not Do Without Confirmation

- Do not deploy.
- Do not run `npm run seed:airtable`.
- Do not run flows that write Airtable records.
- Do not run flows that write Netlify Blobs against production credentials.
- Do not invoke Netlify Functions that refresh or write blob content unless approved.
- Do not modify Notion content.
- Do not modify `.gitignore` to ignore `AGENTS.md`.
- Do not create commits, branches, PRs, releases, or tags.
- Do not overwrite user-owned dirty changes.

## Testing, Build, And Formatting Guidance

- For source changes, prefer `npm run test` and `npm run build` when appropriate.
- `vitest.config.ts` uses the Node test environment.
- `tsconfig.json` compiles `src` to `dist`; root `utils/` and `netlify/functions/` are outside that TypeScript build boundary.
- No separate formatter command was identified in `package.json`.
- For documentation-only changes, read back changed docs and check `git status --short`.
- If skipping build/test, report why.

## Data Contract Warnings

The backend produces the shared blog post contract:

- `id`: Notion page/block ID.
- `tag`: extracted from the expected Notion metadata block.
- `title`: Notion page title.
- `summary`: expected from the first content heading block.
- `link`: slugified title.
- `thumbnail`: backend `notion-image` URL with `blockId`.
- `publishedDate`: Notion created time.
- `updatedDate`: Notion last edited time.
- `body`: ordered sections shaped as `{ heading: string, paras: string[] }`.

`utils/helper.js` assumes a specific Notion page structure. Changes to that structure affect the frontend and RSS generator.

The Airtable seed contract uses fields:

- `Id`
- `Blog Title`
- `Loved`
- `Confused`
- `Thought Provoking`

This Airtable flow creates records and must stay approval-only.

## Secrets And Environment Warnings

- Do not read `.env` or secret files.
- Do not print environment values.
- Inspecting environment variable names in source is okay.
- Observed names include `NOTION_API_KEY`, `NOTION_PAGE_ID`, `BACKEND_ORIGIN`, `NETLIFY_SITE_ID`, `NETLIFY_ACCESS_TOKEN`, `AIRTABLE_API_KEY`, and `AIRTABLE_BASE_ID`.

## PR Workflow Expectations

- Do not create a branch, commit, or PR unless Shayne asks.
- Before a PR, summarize dirty files and identify user-owned changes.
- Include verification commands and skipped commands in any PR summary.
- Call out external-service risks and any cross-repo contract changes.

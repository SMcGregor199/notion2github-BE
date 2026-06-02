# notion2github-BE

Node/TypeScript backend and Netlify Functions layer for `shaynemcgregor.dev`.

## What This Repo Does

- Reads Notion child pages.
- Normalizes Notion content into shared blog JSON.
- Serves blog JSON through Netlify Functions.
- Optimizes Notion page images with Sharp and caches them in Netlify Blobs.
- Provides an Airtable seed flow for blog reaction records.

## Commands

- `npm run dev`: run `tsx src/index.ts`.
- `npm run build`: compile TypeScript.
- `npm run test`: run Vitest.
- `npm run dev:server`: run the Express server stub.
- `npm run start`: run `dist/index.js`.
- `npm run start:server`: run `dist/server/index.js`.
- `npm run seed:airtable`: seed Airtable records. Approval required.
- `npm run clean`: remove `dist/`.

## Local Development Notes

- This repo is clearly Netlify-configured through `netlify.toml`, `netlify/functions/`, and `@netlify/*` dependencies.
- It is the upstream source hub for the shared blog contract.
- The backend contract should be treated as the primary interface for the frontend and RSS generator.

## Artifact And Generated File Cautions

- `dist/` is currently untracked and should be treated as generated output unless proven otherwise.
- Prefer `npm run clean` when you want to remove compiled output.
- Do not run the Airtable seed flow unless the write action is explicitly approved.
- Do not assume blob-writing or deploy-like flows are safe just because they are available in the repo.

## Relation To The Other Repos

- Produces the blog JSON consumed by `notion2github-FE`.
- Produces the image URLs consumed by `notion2github-FE` and `xml-feed-gen`.
- Provides the backend endpoint consumed by `xml-feed-gen`.
- Owns the shared blog data contract that downstream repos should follow.

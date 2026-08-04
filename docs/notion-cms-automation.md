# Notion Blog CMS Automation

The CMS uses Notion as the authoring surface and the backend Netlify site as the generation service.

## New Post Workflow

1. Add a new row to `Blog CMS Posts` and write the article in its page body.
2. Click `Generate Post Assets`.
3. Wait for `Metadata State` to become `Ready`, then review the generated tag, summary, slug, feature image, and Newsletter Intro.
4. Click `Generate Social Drafts`. Wait for `Social Draft State` to become `Ready`, then review and edit the six new rows in `Social Post Drafts`. This step does not publish or schedule anything.
5. Check `Published` when the essay is ready. Notion immediately calculates `Status` as `Live`; the connection webhook assigns `Publication Date` once, locks the page against accidental edits, and refreshes public blog/RSS data. Publishing does not create or change a newsletter or social post.
6. Manually publish the reviewed social copy. Mark each published social row `Published`, then add its `Published at` date and `Publication URL`. For the LinkedIn launch post, also paste its URL into the essay's `LinkedIn Discussion URL` before sending the newsletter.
7. Review the generated Newsletter Intro, then click `Send Newsletter` to set the state to `Queued`. The connection webhook is the only send trigger; publishing the essay or social copy never sends email.

## Blog Series

Create a `Blog Series` data source and add these exact properties:

- `Name` — **Title**
- `Slug` — **Text**; enter this once as the stable public URL identifier
- `Description` — **Text**; optional
- `Posts` — reciprocal **Relation** to `Blog CMS Posts`

Then add a `Series` **Relation** property to `Blog CMS Posts`, pointed at `Blog Series`, and limit it to one related page. Assign a published post to a series by selecting that row. Public members are ordered by `Publication Date` ascending; drafts never appear on the series page or in its previous/next navigation. The launch series is `The Design of Research` with slug `the-design-of-research`.

### Revising a Live Post

To revise a live post, open the page and choose **Locked → Unlock for everyone**. The connection webhook treats that intentional global unlock as an unpublish action: it clears `Published`, the `Status` formula returns to `Draft`, public blog/RSS data refreshes, and the page stays unlocked for editing. Do not use **Unlock for me** for this workflow; it keeps the global lock in place and does not reliably trigger the automation.

## One-Time Notion Setup

Notion database buttons and database automations must be configured in the Notion UI; the Notion API does not expose their configuration. The Free-plan workflow below uses a Notion API connection webhook, not Notion's paid **Send webhook** automation action.

Create a default database template named `New Blog Draft` with `Published` unchecked, `Metadata State` set to `New`, and `Social Draft State` set to `New`. Notion calculates `Status` as `Draft`. Use that template for every new row.

### Generate Post Assets Button

1. Rename the existing `Generate Metadata` property to `Generate Post Assets`.
2. Configure the button to edit **This page**, set `Metadata State` to `Queued`, and clear `Metadata Error`.
3. Save. Do not add a **Send webhook** action or an automation: Notion's connection webhook receives the property change automatically.

Clicking the button again regenerates and replaces the tag, summary, slug, feature image, and Newsletter Intro. When the title has not changed, the slug remains the same. Generation sets a blank `Newsletter State` to `Draft` in the same update, but preserves any existing state, including `Sent`.

### Social Post Drafts Database and Button

Under `Blogging`, create a `Social Post Drafts` data source with these exact properties:

- `Name` — **Title**
- `Platform` — **Select** with `LinkedIn` and `Substack`
- `Sequence` — **Select** with `Launch`, `Follow-up 1`, and `Follow-up 2`
- `Status` — **Select** with `Draft`, `Published`, and `Superseded`
- `Blog CMS post` — **Relation** to `Blog CMS Posts`
- `Blog series` — **Relation** to `Blog Series`
- `Published at` — **Date**
- `Publication URL` — **URL**
- `Origin` — **Select** with `Generated` and `Backfilled`

The editable social copy belongs in each page body, not in a database property. Share this data source with the existing Notion integration. The backend validates these exact property names and types before asking the model for copy.

Add these properties to `Blog CMS Posts`:

- `Social Draft State` — **Select** with `New`, `Queued`, `Processing`, `Ready`, and `Failed`
- `Social Draft Error` — **Text**
- `Generate Social Drafts` — **Button**

Configure `Generate Social Drafts` to edit **This page**, set `Social Draft State` to `Queued`, and clear `Social Draft Error`. Do not add a paid automation, direct webhook action, schedule, publishing action, or Publishing Calendar update. The existing Notion connection webhook receives the property change automatically.

Generation requires the CMS row to have a title, non-empty article body, and slug. `Generate Post Assets` normally supplies the slug, so run and review that workflow first. One request produces exactly six `Draft` rows: a LinkedIn/Substack launch pair, useful-idea pair, and question/reflection pair. Every row links back to the CMS post and copies its optional series relation. Each pair shares an angle but has platform-specific copy, including the canonical `https://shaynemcgregor.dev/blog/<slug>` URL.

Generated rows are review material only. The workflow does not update the Publishing Calendar, schedule a post, call LinkedIn or Substack, publish the essay, or send a newsletter.

#### Archive Backfill and Voice References

Backfill the exact published copy for the first two essays by creating one row per actual LinkedIn or Substack post. Paste the copy verbatim into the page body, set `Origin` to `Backfilled` and `Status` to `Published`, and fill the platform, sequence, CMS-post relation, series relation, published date, and publication URL. Do not reconstruct the copy from screenshots or older drafts. The reset Note may be added as an optional standalone `Published`/`Backfilled` reference; leave relations empty when it is not tied to an essay or series.

Only rows whose current `Status` is `Published` are eligible voice references. The generator prioritizes up to six recent published examples from the same platform and series, then fills the remaining reference slots with recent published examples from that platform. Generated `Draft` rows and `Superseded` rows are never used as voice examples.

After manually publishing future copy, update that row's `Status` to `Published` and add `Published at` and `Publication URL`. This is the review gate that allows the final copy to teach later generations.

#### Regeneration

Generation refuses to run while any `Draft` or `Published` social row remains linked to the CMS post. It never overwrites page-body copy. To generate a replacement set, first mark every prior linked row `Superseded`, then click `Generate Social Drafts` again. The CMS row moves to `Failed` with a reviewable error if active rows remain.

### Newsletter Properties and Send Button

Add these properties to `Blog CMS Posts` before deploying the newsletter code:

- `Newsletter Intro` — **Text**
- `LinkedIn Discussion URL` — **URL**
- `Newsletter State` — **Select** with `Draft`, `Queued`, `Sending`, `Sent`, and `Failed`
- `Newsletter Sent At` — **Date**
- `Newsletter Error` — **Text**
- `Newsletter Broadcast ID` — **Text**

Add a `Send Newsletter` **Button** that edits **This page** and sets `Newsletter State` to `Queued`. It must not call the backend directly and should not modify any other newsletter fields. The Notion connection webhook sees that property change, checks the draft, creates one Resend broadcast, sends it, and writes the broadcast ID and `Sent` state back to the row. A post with a broadcast ID or sent timestamp is never sent again, including after publish toggles or a repeated button click.

The newsletter requires a non-empty intro and a valid LinkedIn discussion URL. If either is missing, the row moves to `Failed` with a reviewable error; correct it, then set the state to `Queued` again.

### Free-plan Connection Webhook

1. In the [Notion Developer Portal](https://www.notion.so/profile/integrations), open the existing connection that owns `NOTION_API_KEY` and confirm it has access to `Blog CMS Posts`, `Blog Series`, and `Social Post Drafts`.
2. Open the connection's **Webhooks** tab and create a subscription with this URL:

   `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-notion-webhook`

3. Select `page.properties_updated` and `page.unlocked` events. Notion sends a verification request to the endpoint.
4. In the backend site's Netlify function logs, copy the received verification token. Add it as the private `NOTION_WEBHOOK_VERIFICATION_TOKEN` environment variable, redeploy the backend, and paste that same token into Notion's verification dialog.
5. Confirm the subscription is active. Notion signs later events with this token; the backend rejects unsigned or invalid events.

The public webhook verifies the signed Notion event, then starts a protected Netlify Background Function for long-running generation work. Notion receives an immediate acknowledgement while the background job can continue safely. The webhook reacts when `Metadata State` or `Social Draft State` changes to `Queued`, when `Published` changes, when a published post's `Series` relation changes, when a `Blog Series` name, slug, or description changes, or when a page is globally unlocked. Changing `Published` to either checked or unchecked aligns the native page lock and refreshes public blog/RSS data. Globally unlocking a published post clears `Published` and refreshes public data.

## Resource Guide URL Enrichment

This is a separate workflow from the blog CMS, social drafts, newsletter, and RSS. It never changes blog data or cache state.

Share the Resource Guide data source with the existing Notion integration, then add these exact properties:

- `Enrichment State` — **Select**: `New`, `Queued`, `Processing`, `Ready`, `Failed`
- `Enrichment Error` — **Text**
- `Enrich Resource` — **Button**

Configure `Enrich Resource` to edit **This page**, set `Enrichment State` to `Queued`, and clear `Enrichment Error`. Do not add a paid automation or direct webhook action. Create a `New Resource` database template with `Name` set to `Untitled Resource`, `Publication Status` set to `Draft`, and `Enrichment State` set to `New`. The only required author input is `URL`.

Create a dedicated Notion connection-webhook subscription for:

`https://shaynemcgregordev-be.netlify.app/.netlify/functions/resource-guide-notion-webhook`

Select only `page.properties_updated`. Copy its one-time verification token from the function log into the private backend variable `RESOURCE_GUIDE_WEBHOOK_VERIFICATION_TOKEN`, redeploy, then paste the same token into Notion's verification dialog. This endpoint uses a different token from the blog CMS webhook and starts the protected `resource-guide-notion-webhook-background` worker.

The worker processes a Resource Guide page only when its state is `Queued`, then records `Processing`, `Ready`, or `Failed`. It retrieves the supplied URL directly and accepts only public HTTP(S) HTML pages with safe redirects, bounded response size, and a timeout. Blocked, paywalled, JavaScript-only, non-HTML, private-address, or unreadable sources become `Failed` with a short recovery-oriented error; no web-search fallback, source HTML, or article text is retained. It uses the existing server-side OpenAI key to replace only automation-owned metadata fields. `URL`, `Public Annotation`, `Private Research Notes`, `Publication Status`, `Featured`, and `Sort Priority` are never written by enrichment. New records remain Draft for review.

Set optional `RESOURCE_GUIDE_TEXT_MODEL` to override the text model. Without it, enrichment uses `CMS_TEXT_MODEL`, then `gpt-5.6-luna`. It also requires the existing `OPENAI_API_KEY`, `NOTION_API_KEY`, and `NOTION_RESOURCES_DATABASE_ID`. Generated category/type/discipline/stage/AI-role values are restricted to the current Notion schema. Tags may be newly added by the integration and are normalized and deduplicated (for example `AI`, `LLM`, and `UN` retain capitals).

Any Resource Guide public-data or publication-status change deletes only the Resource Guide Blob manifest. The next `/resource-guide-data` request rebuilds that guide snapshot immediately; blog JSON, RSS, and their caches are not touched.

### Optional Paid-plan Automations

If the workspace later moves to a paid Notion plan, the existing direct endpoints remain available for database automations:

- Metadata URL: `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-generate`
- Publish URL: `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-publish-sync`
- Header: `X-CMS-Webhook-Secret` with the Netlify `CMS_WEBHOOK_SECRET` value.
- Include `CMS Record ID` in the automation payload.

The `Status` formula derives its value from `Published`: checked is `Live`, unchecked is `Draft`. The publish endpoint only sets `Publication Date` when the checkbox is true and the field is empty. Unpublishing hides the post, unlocks its page, and retains its original publication date.

## Existing Published Post Lock Reconciliation

After deploying the page-lock implementation and adding `page.unlocked` to the Notion webhook subscription, run this protected backend endpoint once to align existing CMS pages with their current `Published` values:

`POST https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-reconcile-page-locks`

Pass the existing `X-CMS-Webhook-Secret` header. The response reports inspected, locked, unlocked, and unchanged counts. The operation is idempotent, so it is safe to rerun; it changes only pages whose native lock state does not match `Published`.

## Netlify Variables

Set these private variables on the backend Netlify site before enabling the Notion automations:

- `OPENAI_API_KEY`: OpenAI API project key with paid billing enabled.
- `CMS_WEBHOOK_SECRET`: a long randomly generated value shared only with the two Notion webhook headers.
- `CMS_TEXT_MODEL`: optional, defaults to `gpt-5.6-luna`.
- `CMS_IMAGE_MODEL`: optional, defaults to `gpt-image-2`.
- `CMS_IMAGE_QUALITY`: optional, defaults to `high`.
- `NOTION_WEBHOOK_VERIFICATION_TOKEN`: required for the free-plan connection webhook; copy the one-time token from the verification request into this private variable before activating the subscription.
- `NOTION_SOCIAL_POSTS_DATABASE_ID`: the `Social Post Drafts` data-source ID.

`NOTION_API_KEY` must have access to `Blog CMS Posts`, `Blog Series`, and `Social Post Drafts`; `NOTION_DATABASE_ID` must remain set to the CMS data-source ID. Set `NOTION_BLOG_SERIES_DATABASE_ID` to the `Blog Series` data-source ID before assigning any series. Social generation reuses `OPENAI_API_KEY` and `CMS_TEXT_MODEL`; it does not need an image model or social-platform credential.

## Newsletter Setup and Activation

This is a separate production-activation checklist. Do not enable the button, form, or Resend webhook until all steps are complete.

1. Create a private Notion data source named `Blog Subscribers`, share it only with the existing Notion integration, and set `NOTION_SUBSCRIBERS_DATABASE_ID` to its database or data-source ID. Add the following exact properties:
   - `First Name` (**Title**), `Last Name` (**Text**), `Email` (**Email**), `Why Subscribe` (**Text**)
   - `Status` (**Select**): `Pending`, `Subscribed`, `Unsubscribed`, `Bounced`
   - `Consent At` (**Date**), `Confirmed At` (**Date**), `Confirmation Token Hash` (**Text**), `Confirmation Token Expires At` (**Date**), `Resend Contact ID` (**Text**), `Source` (**Select**, including `Website`)
2. Verify `shaynemcgregor.dev` in Resend and publish the SPF/DKIM records Resend gives you through Netlify DNS. Do not activate sending until Resend reports the domain verified. Send from `Shayne McGregor <updates@shaynemcgregor.dev>`.
3. Configure a dedicated inbound-mail forwarding provider in Netlify DNS so replies to `updates@shaynemcgregor.dev` forward to the existing Gmail inbox. This project intentionally has no inbound-email handler.
4. In Resend, create a `Notes from Shayne` segment and matching topic. Keep their IDs private and use the segment for broadcasts.
5. Set these private backend Netlify variables (without committing values):
   - `NOTION_SUBSCRIBERS_DATABASE_ID`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `NEWSLETTER_ADMIN_EMAIL` (the private inbox that receives confirmed-subscriber alerts)
   - `RESEND_FROM_EMAIL` (`Shayne McGregor <updates@shaynemcgregor.dev>`), `RESEND_REPLY_TO` (`updates@shaynemcgregor.dev`)
   - `RESEND_BLOG_UPDATES_SEGMENT_ID`, `RESEND_BLOG_UPDATES_TOPIC_ID`
   - `NEWSLETTER_CONFIRMATION_BASE_URL` (the deployed `newsletter-confirm` function URL), `NEWSLETTER_SITE_URL` (`https://shaynemcgregor.dev`), `BACKEND_ORIGIN` (the deployed backend origin, required for the feature image URL), and optionally `NEWSLETTER_ALLOWED_ORIGIN`
6. Register `https://shaynemcgregordev-be.netlify.app/.netlify/functions/resend-webhook` in Resend. Subscribe it to contact updates and `email.bounced`. The function verifies Resend's Svix signature before changing Notion; an unsubscribe becomes `Unsubscribed`, and a permanent bounce becomes `Bounced`.
7. Run the end-to-end checks with a test address: form validation, a pending Notion record, a valid confirmation and owner alert, expired/replayed confirmation links, Resend contact/segment/topic sync, an unsubscribe webhook, a permanent-bounce webhook, first-publish draft creation, missing-draft send failure, and one successful newsletter broadcast. Owner-alert failures are logged but never invalidate a legitimate subscription.

The new endpoint set is `newsletter-subscribe`, `newsletter-confirm`, `resend-webhook`, and `newsletter-send`. The subscription and confirmation endpoints are public by design but validate inputs and use non-revealing responses; Resend webhooks require their signed request; the direct send endpoint requires `CMS_WEBHOOK_SECRET`. The public frontend never receives a provider credential.

## Failure Recovery

If post-asset generation fails, the post remains unpublished, `Metadata State` becomes `Failed`, and `Metadata Error` contains the reason. Correct the title/content or environment configuration, then click `Generate Post Assets` again.

If social generation fails, `Social Draft State` becomes `Failed` and `Social Draft Error` contains the reason. Missing title, body, slug, data-source access, schema, or model output is detected before any draft row is created. If Notion fails during row creation, the backend attempts to archive every newly created row before recording the CMS failure. Correct the prerequisite or mark old rows `Superseded`, then click `Generate Social Drafts` again.

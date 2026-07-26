# Notion Blog CMS Automation

The CMS uses Notion as the authoring surface and the backend Netlify site as the generation service.

## New Post Workflow

1. Add a new row to `Blog CMS Posts` and write the article in its page body.
2. Click `Generate Post Assets`.
3. Wait for `Metadata State` to become `Ready`, then review the generated tag, summary, slug, feature image, and Newsletter Intro.
4. Check `Published` when the post is ready. Notion immediately calculates `Status` as `Live`; the connection webhook assigns `Publication Date` once, locks the page against accidental edits, and refreshes public blog/RSS data. Publishing does not create or change a newsletter.
5. Review the generated Newsletter Intro, publish the LinkedIn discussion post and paste its URL, then click `Send Newsletter` to set the state to `Queued`. The connection webhook is the only send trigger; publishing never sends email.

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

Create a default database template named `New Blog Draft` with `Published` unchecked and `Metadata State` set to `New`. Notion calculates `Status` as `Draft`. Use that template for every new row.

### Generate Post Assets Button

1. Rename the existing `Generate Metadata` property to `Generate Post Assets`.
2. Configure the button to edit **This page**, set `Metadata State` to `Queued`, and clear `Metadata Error`.
3. Save. Do not add a **Send webhook** action or an automation: Notion's connection webhook receives the property change automatically.

Clicking the button again regenerates and replaces the tag, summary, slug, feature image, and Newsletter Intro. When the title has not changed, the slug remains the same. Generation sets a blank `Newsletter State` to `Draft` in the same update, but preserves any existing state, including `Sent`.

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

1. In the [Notion Developer Portal](https://www.notion.so/profile/integrations), open the existing connection that owns `NOTION_API_KEY` and confirm it has access to `Blog CMS Posts` and `Blog Series` only.
2. Open the connection's **Webhooks** tab and create a subscription with this URL:

   `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-notion-webhook`

3. Select `page.properties_updated` and `page.unlocked` events. Notion sends a verification request to the endpoint.
4. In the backend site's Netlify function logs, copy the received verification token. Add it as the private `NOTION_WEBHOOK_VERIFICATION_TOKEN` environment variable, redeploy the backend, and paste that same token into Notion's verification dialog.
5. Confirm the subscription is active. Notion signs later events with this token; the backend rejects unsigned or invalid events.

The public webhook verifies the signed Notion event, then starts a protected Netlify Background Function for long-running image generation and upload. Notion receives an immediate acknowledgement while the background job can continue safely. The webhook reacts when `Metadata State` changes to `Queued`, when `Published` changes, when a published post's `Series` relation changes, when a `Blog Series` name, slug, or description changes, or when a page is globally unlocked. Changing `Published` to either checked or unchecked aligns the native page lock and refreshes public blog/RSS data. Globally unlocking a published post clears `Published` and refreshes public data.

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

`NOTION_API_KEY` must have access to `Blog CMS Posts` and `Blog Series`; `NOTION_DATABASE_ID` must remain set to the CMS data-source ID. Set `NOTION_BLOG_SERIES_DATABASE_ID` to the `Blog Series` data-source ID before assigning any series.

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

If a generation fails, the post remains unpublished, `Metadata State` becomes `Failed`, and `Metadata Error` contains the reason. Correct the title/content or environment configuration, then click `Generate Post Assets` again.

# Notion Blog CMS Automation

The CMS uses Notion as the authoring surface and the backend Netlify site as the generation service.

## New Post Workflow

1. Add a new row to `Blog CMS Posts` and write the article in its page body.
2. Click `Generate Metadata`.
3. Wait for `Metadata State` to become `Ready`, then review the generated tag, summary, slug, and feature image.
4. Check `Published` when the post is ready. Notion immediately calculates `Status` as `Live`; the connection webhook assigns `Publication Date` once and refreshes public blog/RSS data.

## One-Time Notion Setup

Notion database buttons and database automations must be configured in the Notion UI; the Notion API does not expose their configuration. The Free-plan workflow below uses a Notion API connection webhook, not Notion's paid **Send webhook** automation action.

Create a default database template named `New Blog Draft` with `Published` unchecked and `Metadata State` set to `New`. Notion calculates `Status` as `Draft`. Use that template for every new row.

### Generate Metadata Button

1. Add a `Generate Metadata` property of type **Button**.
2. Configure the button to edit **This page**, set `Metadata State` to `Queued`, and clear `Metadata Error`.
3. Save. Do not add a **Send webhook** action or an automation: Notion's connection webhook receives the property change automatically.

Clicking the button again regenerates and replaces the tag, summary, slug, and feature image. When the title has not changed, the slug remains the same.

### Free-plan Connection Webhook

1. In the [Notion Developer Portal](https://www.notion.so/profile/integrations), open the existing connection that owns `NOTION_API_KEY` and confirm it has access to `Blog CMS Posts` only.
2. Open the connection's **Webhooks** tab and create a subscription with this URL:

   `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-notion-webhook`

3. Select only `page.properties_updated` events. Notion sends a verification request to the endpoint.
4. In the backend site's Netlify function logs, copy the received verification token. Add it as the private `NOTION_WEBHOOK_VERIFICATION_TOKEN` environment variable, redeploy the backend, and paste that same token into Notion's verification dialog.
5. Confirm the subscription is active. Notion signs later events with this token; the backend rejects unsigned or invalid events.

The webhook reacts only when `Metadata State` changes to `Queued` or `Published` changes. Changing `Published` to either checked or unchecked runs the existing publication sync and refreshes public blog/RSS data.

### Optional Paid-plan Automations

If the workspace later moves to a paid Notion plan, the existing direct endpoints remain available for database automations:

- Metadata URL: `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-generate`
- Publish URL: `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-publish-sync`
- Header: `X-CMS-Webhook-Secret` with the Netlify `CMS_WEBHOOK_SECRET` value.
- Include `CMS Record ID` in the automation payload.

The `Status` formula derives its value from `Published`: checked is `Live`, unchecked is `Draft`. The publish endpoint only sets `Publication Date` when the checkbox is true and the field is empty. Unpublishing hides the post but retains its original publication date.

## Netlify Variables

Set these private variables on the backend Netlify site before enabling the Notion automations:

- `OPENAI_API_KEY`: OpenAI API project key with paid billing enabled.
- `CMS_WEBHOOK_SECRET`: a long randomly generated value shared only with the two Notion webhook headers.
- `CMS_TEXT_MODEL`: optional, defaults to `gpt-5.6-luna`.
- `CMS_IMAGE_MODEL`: optional, defaults to `gpt-image-2`.
- `CMS_IMAGE_QUALITY`: optional, defaults to `high`.
- `NOTION_WEBHOOK_VERIFICATION_TOKEN`: required for the free-plan connection webhook; copy the one-time token from the verification request into this private variable before activating the subscription.

`NOTION_API_KEY` must have access to `Blog CMS Posts`; `NOTION_DATABASE_ID` must remain set to the CMS data-source ID.

## Failure Recovery

If a generation fails, the post remains unpublished, `Metadata State` becomes `Failed`, and `Metadata Error` contains the reason. Correct the title/content or environment configuration, then click `Generate Metadata` again.

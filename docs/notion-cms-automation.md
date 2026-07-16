# Notion Blog CMS Automation

The CMS uses Notion as the authoring surface and the backend Netlify site as the generation service.

## New Post Workflow

1. Add a new row to `Blog CMS Posts` and write the article in its page body.
2. Click `Generate Metadata`.
3. Wait for `Metadata State` to become `Ready`, then review the generated tag, summary, slug, and feature image.
4. Check `Published` when the post is ready. `Status` immediately reads `Live`, `Publication Date` is assigned once, and the public blog/RSS data refreshes.

## One-Time Notion Setup

Notion database buttons and database automations must be configured in the Notion UI; the Notion API does not expose their configuration.

Create a default database template named `New Blog Draft` with `Published` unchecked and `Metadata State` set to `New`. Use that template for every new row.

### Generate Metadata Button

1. Add a `Generate Metadata` property of type **Button**.
2. Configure the button to edit **This page** and set `Metadata State` to `Queued`.
3. Add a database automation with trigger: `Metadata State` is set to `Queued`.
4. Configure **Send webhook**:
   - URL: `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-generate`
   - Header: `X-CMS-Webhook-Secret` with the value of the Netlify `CMS_WEBHOOK_SECRET` variable.
   - Include the `CMS Record ID` property in the webhook payload.

### Publish Sync Automation

1. Add a database automation with trigger: `Published` is edited.
2. Configure **Send webhook**:
   - URL: `https://shaynemcgregordev-be.netlify.app/.netlify/functions/cms-publish-sync`
   - Header: `X-CMS-Webhook-Secret` with the value of the Netlify `CMS_WEBHOOK_SECRET` variable.
   - Include the `CMS Record ID` property in the webhook payload.

The publish endpoint only sets `Publication Date` when the checkbox is true and the field is empty. Unpublishing hides the post but retains its original publication date.

## Netlify Variables

Set these private variables on the backend Netlify site before enabling the Notion automations:

- `OPENAI_API_KEY`: OpenAI API project key with paid billing enabled.
- `CMS_WEBHOOK_SECRET`: a long randomly generated value shared only with the two Notion webhook headers.
- `CMS_TEXT_MODEL`: optional, defaults to `gpt-5.6-luna`.
- `CMS_IMAGE_MODEL`: optional, defaults to `gpt-image-2`.
- `CMS_IMAGE_QUALITY`: optional, defaults to `high`.

`NOTION_API_KEY` must have access to `Blog CMS Posts`; `NOTION_DATABASE_ID` must remain set to the CMS data-source ID.

## Failure Recovery

If a generation fails, the post remains unpublished, `Metadata State` becomes `Failed`, and `Metadata Error` contains the reason. Correct the title/content or environment configuration, set `Metadata State` back to `Queued`, and run the button again.

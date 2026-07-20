import { handleCmsNotionWebhookBackground } from "../../src/cms/notionWebhookBackgroundHandler.js";

export default async function cmsNotionWebhookBackground(request: Request): Promise<Response> {
  return handleCmsNotionWebhookBackground(request);
}

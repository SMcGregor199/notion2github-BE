import { handleCmsNotionWebhook } from "../../src/cms/notionWebhookHandler.js";

export default async function cmsNotionWebhook(request: Request): Promise<Response> {
  return handleCmsNotionWebhook(request);
}

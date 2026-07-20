import { handleCmsNotionWebhook } from "../../src/cms/notionWebhookHandler.js";

export const config = {
  background: true,
};

export default async function cmsNotionWebhook(request: Request): Promise<Response> {
  return handleCmsNotionWebhook(request);
}

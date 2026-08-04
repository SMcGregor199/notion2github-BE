import { handleResourceGuideNotionWebhook } from "../../src/resources/resourceGuideNotionWebhookHandler.js";

export default async function resourceGuideNotionWebhook(request: Request): Promise<Response> {
  return handleResourceGuideNotionWebhook(request);
}

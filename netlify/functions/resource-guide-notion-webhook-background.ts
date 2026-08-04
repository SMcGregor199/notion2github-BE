import { getStore } from "@netlify/blobs";
import { createResourceGuideNotionWebhookBackgroundHandler } from "../../src/resources/resourceGuideNotionWebhookBackgroundHandler.js";
import type { ResourceGuideStore } from "../../src/resources/types.js";

const handler = createResourceGuideNotionWebhookBackgroundHandler(
  getStore("resources", { consistency: "strong" }) as unknown as ResourceGuideStore,
);

export default handler;

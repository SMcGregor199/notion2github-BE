import { handleCmsReconcilePageLocks } from "../../src/cms/cmsReconcilePageLocksHandler.js";

export default async function cmsReconcilePageLocks(request: Request): Promise<Response> {
  return handleCmsReconcilePageLocks(request);
}

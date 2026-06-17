import { handleReactionRequest } from "../../src/reactions/http.js";

export default async (request: Request): Promise<Response> => {
  return handleReactionRequest(request);
};

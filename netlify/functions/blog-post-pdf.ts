import { getStore } from "@netlify/blobs";
import { serveBlogPostPdf } from "../../src/pdf/blogPostPdf.ts";

export default async (request: Request) => serveBlogPostPdf({
  store: getStore("content", { consistency: "strong" }),
  request,
});

import { getStore } from "@netlify/blobs";

export async function handler(event) {
  const store = getStore({ name: "demo-store" });

  // Write
  await store.set("message", "Hello Netlify Blobs!");

  // Read
  const msg = await store.get("message");

  return {
    statusCode: 200,
    body: `Stored message: ${msg}`,
  };
}
import { KarakeepClient } from "./karakeep";
import { processBookmark } from "./main";
import { createWebhookHandler } from "./webhook";

const apiKey = Bun.env.KARAKEEP_API_KEY;
if (!apiKey) throw new Error("KARAKEEP_API_KEY is required");
const webhookToken = Bun.env.KARAKEEP_WEBHOOK_TOKEN;
if (!webhookToken) throw new Error("KARAKEEP_WEBHOOK_TOKEN is required");

const port = Number(Bun.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be 1–65535");
const client = new KarakeepClient(Bun.env.KARAKEEP_URL || "https://cloud.karakeep.app", apiKey);
const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch: createWebhookHandler(
    webhookToken,
    (id) => client.getBookmark(id),
    (bookmark) => processBookmark(client, bookmark),
  ),
});
console.log(`Listening for Karakeep crawled webhooks on ${server.url}webhook`);

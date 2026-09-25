import { expect, test } from "bun:test";
import type { Bookmark } from "../src/karakeep";
import { createWebhookHandler } from "../src/webhook";

const payload = {
  jobId: "job-1",
  bookmarkId: "bookmark-1",
  userId: "user-1",
  url: "https://m.weibo.cn/status/123",
  type: "link",
  operation: "crawled",
};

function request(body: unknown, token = "secret") {
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("webhook authenticates, filters events, and acknowledges duplicate jobs", async () => {
  let resolveProcessed!: () => void;
  const processed = new Promise<void>((resolve) => (resolveProcessed = resolve));
  let calls = 0;
  const handler = createWebhookHandler(
    "secret",
    async () => ({ id: payload.bookmarkId, content: { type: "link", url: payload.url } }),
    async () => {
      calls++;
      resolveProcessed();
      return "updated";
    },
  );

  expect((await handler(request(payload, "wrong"))).status).toBe(401);
  expect((await handler(request({ ...payload, operation: "edited" }))).status).toBe(204);
  expect((await handler(request(payload))).status).toBe(202);
  expect((await handler(request(payload))).status).toBe(202);
  await processed;
  expect(calls).toBe(1);
});

test("webhook skips a bookmark whose URL changed after the crawl", async () => {
  let calls = 0;
  let resolveFetched!: () => void;
  const fetched = new Promise<void>((resolve) => (resolveFetched = resolve));
  const handler = createWebhookHandler(
    "secret",
    async (): Promise<Bookmark> => {
      resolveFetched();
      return { id: payload.bookmarkId, content: { type: "link", url: "https://example.com" } };
    },
    async () => {
      calls++;
      return "updated";
    },
  );
  expect((await handler(request(payload))).status).toBe(202);
  await fetched;
  expect(calls).toBe(0);
});

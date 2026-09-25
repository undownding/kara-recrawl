import { timingSafeEqual } from "node:crypto";
import type { Bookmark } from "./karakeep";

interface CrawledEvent {
  jobId: string;
  bookmarkId: string;
  type: "link";
  url: string;
  operation: "crawled";
}

function isCrawledEvent(value: unknown): value is CrawledEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    event.operation === "crawled" &&
    event.type === "link" &&
    typeof event.jobId === "string" &&
    event.jobId.length > 0 &&
    typeof event.bookmarkId === "string" &&
    event.bookmarkId.length > 0 &&
    typeof event.url === "string" &&
    /^https?:\/\//.test(event.url)
  );
}

function authorized(header: string | null, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createWebhookHandler(
  token: string,
  getBookmark: (id: string) => Promise<Bookmark>,
  process: (bookmark: Bookmark) => Promise<string>,
) {
  const seen = new Map<string, number>();
  let pending = Promise.resolve();

  async function run(event: CrawledEvent): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const bookmark = await getBookmark(event.bookmarkId);
        if (bookmark.content?.type !== "link" || bookmark.content.url !== event.url) {
          console.log(`Skipped stale webhook: ${event.bookmarkId} (${event.jobId})`);
          return;
        }
        const result = await process(bookmark);
        console.log(`${result}: ${event.bookmarkId} (${event.jobId})`);
        return;
      } catch (error) {
        if (attempt === 3) {
          console.error(`Webhook processing failed: ${event.bookmarkId} (${event.jobId})`, error);
          return;
        }
        await wait(1000 * 2 ** (attempt - 1));
      }
    }
  }

  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") return new Response("ok");
    if (path !== "/webhook") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!authorized(request.headers.get("authorization"), token))
      return new Response("Unauthorized", { status: 401 });

    if (Number(request.headers.get("content-length") ?? 0) > 16_384)
      return new Response("Payload too large", { status: 413 });
    let event: unknown;
    try {
      const body = await request.text();
      if (body.length > 16_384) return new Response("Payload too large", { status: 413 });
      event = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (
      !event ||
      typeof event !== "object" ||
      (event as { operation?: unknown }).operation !== "crawled"
    )
      return new Response(null, { status: 204 });
    if (!isCrawledEvent(event)) return new Response("Invalid crawled event", { status: 400 });

    const now = Date.now();
    for (const [jobId, timestamp] of seen) if (now - timestamp > 86_400_000) seen.delete(jobId);
    if (seen.has(event.jobId)) return Response.json({ status: "duplicate" }, { status: 202 });
    seen.set(event.jobId, now);
    pending = pending.then(() => run(event));
    return Response.json({ status: "queued" }, { status: 202 });
  };
}

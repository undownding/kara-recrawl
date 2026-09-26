export interface WeiboPost {
  id?: string | number;
  mid?: string | number;
  text?: string;
  text_raw?: string;
  isLongText?: boolean;
  longText?: { longTextContent?: string };
  pics?: Array<{
    pid?: string;
    large?: { url?: string };
    url?: string;
    type?: string;
    videoSrc?: string;
  }>;
  pic_num?: number;
  pic_ids?: string[];
  pic_infos?: Record<string, { largest?: { url?: string }; large?: { url?: string } }>;
  retweeted_status?: WeiboPost;
  page_info?: {
    type?: string;
    object_id?: string;
    media_info?: { stream_url?: string; stream_url_hd?: string };
    urls?: Record<string, string>;
  };
}

export interface WeiboCapture {
  title: string;
  description: string;
  posts: Array<{ id: string; text: string; role: "original" | "repost" }>;
  images: Array<{ key: string; url: string; sourceStatusId: string; role: "original" | "repost" }>;
  videos: Array<{ key: string; url: string; sourceStatusId: string; role: "original" | "repost" }>;
}

export function statusId(url: URL): string {
  const match = url.pathname.match(/^\/(?:status|detail)\/([A-Za-z0-9]+)\/?$/);
  if (!match) throw new Error(`Unsupported Weibo status URL: ${url.href}`);
  return match[1];
}

export function htmlToText(input: string): string {
  return input
    .replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, "$1")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      if (entity.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLowerCase()] ?? "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ownImages(post: WeiboPost): Array<{ key: string; url: string }> {
  const results: Array<{ key: string; url: string }> = [];
  const seen = new Set<string>();
  if (post.pic_ids?.length && post.pic_infos) {
    for (const pid of post.pic_ids) {
      const url = post.pic_infos[pid]?.largest?.url ?? post.pic_infos[pid]?.large?.url;
      if (url && !seen.has(url)) {
        results.push({ key: pid, url });
        seen.add(url);
      }
    }
  }
  for (const [index, pic] of (post.pics ?? []).entries()) {
    const url = pic.large?.url ?? pic.url;
    if (url && !seen.has(url)) {
      results.push({ key: pic.pid ?? `${post.id ?? post.mid ?? "post"}-${index}`, url });
      seen.add(url);
    }
  }
  if (post.pic_num !== undefined && results.length < post.pic_num) {
    throw new Error(
      `Weibo ${post.id ?? post.mid ?? "unknown"} provided ${results.length}/${post.pic_num} images`,
    );
  }
  return results;
}

export function collectCapture(root: WeiboPost): WeiboCapture {
  const texts: string[] = [];
  const chain: WeiboPost[] = [];
  let post: WeiboPost | undefined = root;
  let depth = 0;
  while (post) {
    if (++depth > 30) throw new Error("Weibo repost chain is too deep");
    const text = htmlToText(post.longText?.longTextContent ?? post.text_raw ?? post.text ?? "");
    if (!text) throw new Error(`Weibo status ${post.id ?? post.mid ?? "unknown"} has no body`);
    texts.push(text);
    chain.push(post);
    post = post.retweeted_status;
  }
  const posts = chain.map((item, index) => ({
    id: String(item.id ?? item.mid ?? root.id ?? root.mid ?? "unknown"),
    text: texts[index],
    role: (index === chain.length - 1 ? "original" : "repost") as "original" | "repost",
  }));
  const images: WeiboCapture["images"] = [];
  const videos: WeiboCapture["videos"] = [];
  const seen = new Map<string, number>();
  for (const [index, item] of chain.entries()) {
    const role = index === chain.length - 1 ? "original" : "repost";
    const sourceStatusId = String(item.id ?? item.mid ?? root.id ?? root.mid ?? "unknown");
    for (const image of ownImages(item)) {
      const previous = seen.get(image.url);
      if (previous === undefined) {
        seen.set(image.url, images.length);
        images.push({ ...image, sourceStatusId, role });
      } else if (role === "original") {
        images[previous] = { ...image, sourceStatusId, role };
      }
    }
    const videoPictures = (item.pics ?? []).filter((pic) => pic.type === "video");
    for (const [videoIndex, pic] of videoPictures.entries()) {
      const url =
        pic.videoSrc ??
        (videoPictures.length === 1
          ? (item.page_info?.urls?.mp4_720p_mp4 ??
            item.page_info?.media_info?.stream_url_hd ??
            item.page_info?.media_info?.stream_url)
          : undefined);
      if (!url) throw new Error(`Weibo ${sourceStatusId} is missing video ${videoIndex + 1}`);
      if (!videos.some((video) => video.url === url))
        videos.push({
          key: pic.pid ?? `${sourceStatusId}-${videoIndex}`,
          url,
          sourceStatusId,
          role,
        });
    }
    if (item.page_info?.type === "video" && !videoPictures.length) {
      const url =
        item.page_info.urls?.mp4_720p_mp4 ??
        item.page_info.media_info?.stream_url_hd ??
        item.page_info.media_info?.stream_url;
      if (!url) throw new Error(`Weibo ${sourceStatusId} has video metadata but no MP4 URL`);
      if (!videos.some((video) => video.url === url))
        videos.push({ key: item.page_info.object_id ?? sourceStatusId, url, sourceStatusId, role });
    }
  }
  return {
    title: texts[0],
    description: texts.join("\n\n—— 转发原文 ——\n\n"),
    posts,
    images,
    videos,
  };
}

const WEIBO_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";
let anonymousCookie: string | undefined;

async function getAnonymousCookie(visitorHtml: string, returnUrl: string): Promise<string> {
  const requestId = visitorHtml.match(/var request_id = "([^"]+)"/)?.[1];
  if (!requestId) throw new Error("Weibo visitor page did not include a request ID");
  const form = new URLSearchParams({
    cb: "visitor_gray_callback",
    ver: "20250916",
    request_id: requestId,
    tid: "",
    from: "weibo",
    webdriver: "undefined",
    rid: String(Date.now()),
    return_url: returnUrl,
  });
  const response = await fetch("https://visitor.passport.weibo.cn/visitor/genvisitor2", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://visitor.passport.weibo.cn",
      referer: "https://visitor.passport.weibo.cn/",
      "user-agent": WEIBO_USER_AGENT,
    },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Weibo visitor bootstrap returned HTTP ${response.status}`);
  const script = await response.text();
  const start = script.indexOf("{");
  const end = script.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Weibo visitor bootstrap returned invalid JSONP");
  const result = JSON.parse(script.slice(start, end + 1)) as {
    retcode?: number;
    data?: { sub?: string; subp?: string };
  };
  if (result.retcode !== 20000000 || !result.data?.sub || !result.data.subp) {
    throw new Error(`Weibo visitor bootstrap failed: ${result.retcode ?? "unknown"}`);
  }
  return `SUB=${result.data.sub}; SUBP=${result.data.subp}`;
}

async function requestWeibo(url: string, cookie?: string): Promise<Response> {
  return fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: "https://m.weibo.cn/",
      "user-agent": WEIBO_USER_AGENT,
      ...(cookie ? { cookie } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

async function weiboJson(url: string): Promise<Record<string, unknown>> {
  let response = await requestWeibo(url, Bun.env.WEIBO_COOKIE || anonymousCookie);
  if (
    !Bun.env.WEIBO_COOKIE &&
    response.url.startsWith("https://visitor.passport.weibo.cn/") &&
    response.headers.get("content-type")?.includes("html")
  ) {
    anonymousCookie = await getAnonymousCookie(await response.text(), url);
    response = await requestWeibo(url, anonymousCookie);
  }
  if (!response.ok) throw new Error(`Weibo returned HTTP ${response.status} for ${url}`);
  if (!response.headers.get("content-type")?.includes("json")) {
    const reason = response.url.includes("visitor.passport.weibo.cn")
      ? "Weibo visitor verification page"
      : `non-JSON response (${response.headers.get("content-type") ?? "unknown type"})`;
    throw new Error(`${reason} for ${url}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  if (payload.ok !== 1 || !payload.data || typeof payload.data !== "object") {
    throw new Error(
      `Weibo did not return a status for ${url}: ${JSON.stringify(payload).slice(0, 300)}`,
    );
  }
  return payload.data as Record<string, unknown>;
}

export async function fetchWeibo(url: URL): Promise<WeiboCapture> {
  const root = (await weiboJson(
    `https://m.weibo.cn/statuses/show?id=${encodeURIComponent(statusId(url))}`,
  )) as WeiboPost;
  const visited = new Set<string>();
  let node: WeiboPost | undefined = root;
  while (node) {
    const id = String(node.id ?? node.mid ?? "");
    if (id && !visited.has(id)) {
      visited.add(id);
      if (node.isLongText && !node.longText?.longTextContent) {
        const extended = await weiboJson(
          `https://m.weibo.cn/statuses/extend?id=${encodeURIComponent(id)}`,
        );
        const body = extended.longTextContent;
        if (typeof body !== "string" || !body) throw new Error(`Missing long text for Weibo ${id}`);
        node.longText = { longTextContent: body };
      }
    }
    node = node.retweeted_status;
  }
  return collectCapture(root);
}

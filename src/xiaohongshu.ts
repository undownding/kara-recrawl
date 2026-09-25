import { createWebView, prepareXiaohongshuView } from "./webview";

export interface XiaohongshuCapture {
  id: string;
  title: string;
  description: string;
  images: Array<{ url: string }>;
}

interface Note {
  noteId?: string;
  type?: string;
  title?: string;
  desc?: string;
  imageList?: Array<{ urlDefault?: string; urlPre?: string; infoList?: Array<{ url?: string }> }>;
}

export function xiaohongshuNoteId(url: URL): string | null {
  if (!["www.xiaohongshu.com", "xiaohongshu.com"].includes(url.hostname)) return null;
  return url.pathname.match(/^\/(?:discovery\/item|explore)\/([a-f0-9]{24})\/?$/i)?.[1] ?? null;
}

export async function resolveXiaohongshuUrl(url: URL): Promise<URL> {
  if (url.hostname !== "xhslink.cn") return url;
  if (!/^\/o\/[A-Za-z0-9]+\/?$/.test(url.pathname)) return url;
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || !location)
    throw new Error(`Could not resolve Xiaohongshu share URL: HTTP ${response.status}`);
  const target = new URL(location, url);
  if (!xiaohongshuNoteId(target))
    throw new Error(`Xiaohongshu share URL resolved to an unexpected page: ${target}`);
  return target;
}

export function parseXiaohongshuNote(value: unknown, expectedId: string): XiaohongshuCapture {
  if (!value || typeof value !== "object")
    throw new Error(`Xiaohongshu note ${expectedId} is unavailable`);
  const note = value as Note;
  if (note.noteId && note.noteId !== expectedId)
    throw new Error(`Xiaohongshu returned a different note: ${note.noteId}`);
  if (note.type && note.type !== "normal")
    throw new Error(`Xiaohongshu note ${expectedId} is not an image post`);
  const title = note.title?.trim() || note.desc?.trim().split("\n")[0] || "";
  if (!title) throw new Error(`Xiaohongshu note ${expectedId} has no title or body`);
  if (!Array.isArray(note.imageList) || note.imageList.length === 0)
    throw new Error(`Xiaohongshu note ${expectedId} has no images`);
  const images = note.imageList.map((image, index) => {
    const candidate =
      image.urlDefault || image.infoList?.find((item) => item.url)?.url || image.urlPre;
    if (!candidate) throw new Error(`Xiaohongshu note ${expectedId} is missing image ${index + 1}`);
    const url = new URL(candidate.startsWith("//") ? `https:${candidate}` : candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !(
        url.hostname === "xhscdn.com" ||
        url.hostname.endsWith(".xhscdn.com") ||
        url.hostname === "xiaohongshu.com" ||
        url.hostname.endsWith(".xiaohongshu.com")
      )
    )
      throw new Error(`Unexpected Xiaohongshu image host: ${url.hostname}`);
    url.protocol = "https:";
    return { url: url.href };
  });
  return {
    id: expectedId,
    title,
    description: [note.title?.trim(), note.desc?.trim()].filter(Boolean).join("\n\n") || title,
    images,
  };
}

function unwrap(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const wrapped = value as Record<string, unknown>;
  return wrapped._rawValue ?? wrapped._value ?? wrapped.value ?? value;
}

function noteFromState(state: unknown, id: string): unknown {
  const root = unwrap(state) as Record<string, unknown> | undefined;
  const section = unwrap(root?.note) as Record<string, unknown> | undefined;
  const map = unwrap(section?.noteDetailMap) as Record<string, unknown> | undefined;
  const entry = unwrap(map?.[id]) as Record<string, unknown> | undefined;
  const note = unwrap(entry?.note ?? entry) as Record<string, unknown> | undefined;
  return note ? { ...note, imageList: unwrap(note.imageList) } : null;
}

function embeddedState(html: string): unknown {
  const marker = /window\.__INITIAL_STATE__\s*=\s*/g;
  const match = marker.exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  if (html[start] !== "{") return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, index + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parsePublicXiaohongshuHtml(html: string, id: string): XiaohongshuCapture | null {
  const note = noteFromState(embeddedState(html), id);
  if (!note) return null;
  try {
    return parseXiaohongshuNote(note, id);
  } catch {
    return null;
  }
}

export async function fetchPublicXiaohongshu(url: URL): Promise<XiaohongshuCapture | null> {
  const id = xiaohongshuNoteId(url);
  if (!id) throw new Error(`Unsupported Xiaohongshu note URL: ${url}`);
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return null;
  if (xiaohongshuNoteId(new URL(response.url)) !== id) return null;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 5_000_000) return null;
  const html = await response.text();
  if (html.length > 5_000_000) return null;
  return parsePublicXiaohongshuHtml(html, id);
}

export const NOTE_EXPRESSION = `(() => {
  const unwrap = value => value?._rawValue ?? value?._value ?? value?.value ?? value;
  const root = unwrap(window.__INITIAL_STATE__?.note);
  const map = unwrap(root?.noteDetailMap);
  const id = __NOTE_ID__;
  const entry = unwrap(map?.[id]);
  const note = unwrap(entry?.note ?? entry);
  return note ? JSON.stringify({ noteId: note.noteId, type: note.type, title: note.title, desc: note.desc, imageList: unwrap(note.imageList) }) : null;
})()`;

export function xiaohongshuAccessError(
  pageUrl: string,
  title: string,
  text: string,
): string | null {
  const url = new URL(pageUrl);
  if (url.pathname === "/website-login/error") {
    const code = url.searchParams.get("error_code");
    const reason = (url.searchParams.get("error_msg") || text.slice(0, 120) || title).replace(
      /[.。\s]+$/,
      "",
    );
    return `Xiaohongshu blocked browser access${code ? ` (${code})` : ""}: ${reason}. Check the container's outbound network/IP.`;
  }
  if (url.pathname === "/login" || url.pathname.startsWith("/website-login/"))
    return "Xiaohongshu redirected to a login page; configure WEBVIEW_PROFILE_DIR with a signed-in browser profile";
  return null;
}

// Use the page's note state, which contains the complete image carousel. DOM thumbnails may contain only the current image.
export async function captureXiaohongshu(
  url: URL,
  takeScreenshot: boolean,
): Promise<{ capture: XiaohongshuCapture; screenshot: Blob | null }> {
  const id = xiaohongshuNoteId(url);
  if (!id) throw new Error(`Unsupported Xiaohongshu note URL: ${url}`);
  await using view = createWebView(1440, 900);
  await prepareXiaohongshuView(view);
  await view.navigate(url.href);
  let capture: XiaohongshuCapture | undefined;
  let lastPage = "unknown";
  for (let attempt = 0; attempt < 30; attempt++) {
    await Bun.sleep(500);
    const page = (await view.evaluate(
      '({ url: location.href, title: document.title, text: document.body?.innerText?.slice(0, 200) ?? "" })',
    )) as { url: string; title: string; text: string };
    const accessError = xiaohongshuAccessError(page.url, page.title, page.text);
    if (accessError) throw new Error(accessError);
    lastPage = `${new URL(page.url).pathname} (${page.title || "untitled"})`;
    const raw = (await view.evaluate(
      NOTE_EXPRESSION.replace("__NOTE_ID__", JSON.stringify(id)),
    )) as string | null;
    if (raw) {
      capture = parseXiaohongshuNote(JSON.parse(raw), id);
      break;
    }
  }
  if (!capture)
    throw new Error(`Xiaohongshu note ${id} did not load in WebView; page: ${lastPage}`);
  if (!takeScreenshot) return { capture, screenshot: null };

  // The note may be visible behind a login dialog. Click its close control before taking the screenshot.
  await view.evaluate(`(() => {
    const selectors = [
      '.login-container .close', '.login-container .close-icon',
      '.login-modal .close', '.login-modal .close-icon',
      '[class*="login"] [class*="close"]', '[class*="Login"] [class*="close"]',
      '[role="dialog"] [aria-label="关闭"]',
      '[role="dialog"] [aria-label="Close"]'
    ];
    for (const selector of selectors) {
      const button = [...document.querySelectorAll(selector)].find(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (button) { button.click(); break; }
    }
  })()`);
  await Bun.sleep(700);
  const loginDialogVisible = (await view.evaluate(`(() => {
    return [...document.querySelectorAll('.login-container, .login-modal, [role="dialog"]')]
      .some(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 250 && rect.height > 200 && /登录|验证码|log in|sign in/i.test(el.textContent || '');
      });
  })()`)) as boolean;
  if (loginDialogVisible)
    throw new Error(`Xiaohongshu login dialog could not be closed for note ${id}`);
  const screenshot = await view.screenshot({ format: "png" });
  if (!(screenshot instanceof Blob) || screenshot.size < 1000)
    throw new Error("WebView returned an empty Xiaohongshu screenshot");
  return { capture, screenshot };
}

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
      url.protocol !== "https:" ||
      !(
        url.hostname === "xhscdn.com" ||
        url.hostname.endsWith(".xhscdn.com") ||
        url.hostname === "xiaohongshu.com" ||
        url.hostname.endsWith(".xiaohongshu.com")
      )
    )
      throw new Error(`Unexpected Xiaohongshu image host: ${url.hostname}`);
    return { url: url.href };
  });
  return {
    id: expectedId,
    title,
    description: [note.title?.trim(), note.desc?.trim()].filter(Boolean).join("\n\n") || title,
    images,
  };
}

const NOTE_EXPRESSION = `(() => {
  const map = window.__INITIAL_STATE__?.note?.noteDetailMap;
  const id = __NOTE_ID__;
  const entry = map?.[id];
  const note = entry?.note?._value ?? entry?.note ?? entry?._value?.note ?? entry?._value;
  return note ? JSON.stringify({ noteId: note.noteId, type: note.type, title: note.title, desc: note.desc, imageList: note.imageList }) : null;
})()`;

// Use the page's note state, which contains the complete image carousel. DOM thumbnails may contain only the current image.
export async function captureXiaohongshu(
  url: URL,
  takeScreenshot: boolean,
): Promise<{ capture: XiaohongshuCapture; screenshot: Blob | null }> {
  const id = xiaohongshuNoteId(url);
  if (!id) throw new Error(`Unsupported Xiaohongshu note URL: ${url}`);
  await using view = new Bun.WebView({
    width: 1280,
    height: 900,
    backend: { type: "chrome", argv: ["--no-sandbox", "--disable-dev-shm-usage"] },
    ...(Bun.env.WEBVIEW_PROFILE_DIR
      ? { dataStore: { directory: Bun.env.WEBVIEW_PROFILE_DIR } }
      : {}),
  });
  await view.navigate(url.href);
  let capture: XiaohongshuCapture | undefined;
  for (let attempt = 0; attempt < 30; attempt++) {
    await Bun.sleep(500);
    const pageUrl = (await view.evaluate("location.href")) as string;
    if (new URL(pageUrl).pathname === "/login")
      throw new Error(
        `Xiaohongshu redirected note ${id} to the login page; configure WEBVIEW_PROFILE_DIR with a signed-in browser profile`,
      );
    const raw = (await view.evaluate(
      NOTE_EXPRESSION.replace("__NOTE_ID__", JSON.stringify(id)),
    )) as string | null;
    if (raw) {
      capture = parseXiaohongshuNote(JSON.parse(raw), id);
      break;
    }
  }
  if (!capture) throw new Error(`Xiaohongshu note ${id} did not load in WebView`);
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

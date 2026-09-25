const KARAKEEP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function createWebView(width: number, height: number): Bun.WebView {
  return new Bun.WebView({
    width,
    height,
    backend: {
      type: "chrome",
      path: Bun.env.BUN_CHROME_PATH || "/usr/bin/chromium",
      argv: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
    ...(Bun.env.WEBVIEW_PROFILE_DIR
      ? { dataStore: { directory: Bun.env.WEBVIEW_PROFILE_DIR } }
      : {}),
  });
}

export async function prepareXiaohongshuView(view: Bun.WebView): Promise<void> {
  await view.navigate("about:blank");
  await view.cdp("Emulation.setUserAgentOverride", {
    userAgent: KARAKEEP_USER_AGENT,
    acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
    platform: "MacIntel",
  });
  await view.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: 'Object.defineProperty(navigator, "webdriver", { get: () => undefined });',
  });
}

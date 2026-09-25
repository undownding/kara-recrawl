export async function screenshot(url: string, expectedText: string): Promise<Blob> {
  await using view = new Bun.WebView({
    width: 1280,
    height: 900,
    backend: { type: "chrome", argv: ["--no-sandbox", "--disable-dev-shm-usage"] },
    ...(Bun.env.WEBVIEW_PROFILE_DIR
      ? { dataStore: { directory: Bun.env.WEBVIEW_PROFILE_DIR } }
      : {}),
  });
  await view.navigate(url);
  const expected = expectedText.replace(/\s+/g, "").slice(0, 16);
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    await Bun.sleep(500);
    try {
      const page = (await view.evaluate(
        '({ url: location.href, text: document.body?.innerText?.slice(0, 10000) ?? "" })',
      )) as { url: string; text: string };
      if (
        new URL(page.url).hostname === new URL(url).hostname &&
        page.text.replace(/\s+/g, "").includes(expected)
      ) {
        ready = true;
        break;
      }
    } catch {
      // Weibo may redirect through its visitor page while the target is being inspected.
    }
  }
  if (!ready) throw new Error(`WebView did not render the expected Weibo text at ${url}`);
  await Bun.sleep(700);
  const image = await view.screenshot({ format: "png" });
  if (!(image instanceof Blob) || image.size < 1000)
    throw new Error("WebView returned an empty screenshot");
  return image;
}

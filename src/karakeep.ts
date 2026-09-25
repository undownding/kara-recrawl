export interface Bookmark {
  id: string;
  title?: string | null;
  description?: string | null;
  content?: {
    type: string;
    url?: string;
    htmlContent?: string | null;
    contentAssetId?: string | null;
    crawledAt?: string | null;
    readerViewStatus?: string | null;
  };
  assets?: Array<{ id: string; fileName?: string; assetType?: string }>;
}

export function singleFileMultipart(url: string, html: string, fileName: string) {
  const boundary = `kara-recap-${crypto.randomUUID()}`;
  const safeFileName = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  const body = new Blob([
    `--${boundary}\r\nContent-Disposition: form-data; name="url"\r\n\r\n${url}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFileName}"\r\nContent-Type: text/html\r\n\r\n`,
    html,
    `\r\n--${boundary}--\r\n`,
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export class KarakeepClient {
  private readonly base: URL;

  constructor(
    server: string,
    private readonly apiKey: string,
  ) {
    const url = new URL(server);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("KARAKEEP_URL must be HTTP or HTTPS");
    this.base = new URL(`${url.pathname.replace(/\/$/, "")}/api/v1/`, url);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(new URL(path, this.base), {
      ...init,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(
        `Karakeep ${init.method ?? "GET"} ${path}: HTTP ${response.status} ${(await response.text()).slice(0, 400)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private json<T>(path: string, method: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  getBookmark(id: string, includeContent = false): Promise<Bookmark> {
    const query = includeContent ? "?includeContent=true" : "";
    return this.request<Bookmark>(`bookmarks/${encodeURIComponent(id)}${query}`);
  }

  importSingleFile(url: string, html: string, fileName: string): Promise<Bookmark> {
    const form = singleFileMultipart(url, html, fileName);
    return this.request<Bookmark>("bookmarks/singlefile?ifexists=overwrite", {
      method: "POST",
      headers: { "content-type": form.contentType },
      body: form.body,
    });
  }

  updateBookmark(id: string, title: string, description: string): Promise<Bookmark> {
    return this.json<Bookmark>(`bookmarks/${encodeURIComponent(id)}`, "PATCH", {
      title: title.slice(0, 1000),
      description,
    });
  }

  async upload(bytes: Blob, fileName: string): Promise<string> {
    const form = new FormData();
    form.append("file", bytes, fileName);
    const result = await this.request<{ assetId: string }>("assets", {
      method: "POST",
      body: form,
    });
    if (!result.assetId) throw new Error("Karakeep asset upload returned no assetId");
    return result.assetId;
  }

  attachAsset(
    bookmarkId: string,
    assetId: string,
    assetType: "bookmarkAsset" | "screenshot" | "bannerImage",
  ): Promise<unknown> {
    return this.json(`bookmarks/${encodeURIComponent(bookmarkId)}/assets`, "POST", {
      id: assetId,
      assetType,
    });
  }

  replaceAsset(bookmarkId: string, oldAssetId: string, newAssetId: string): Promise<void> {
    return this.json<void>(
      `bookmarks/${encodeURIComponent(bookmarkId)}/assets/${encodeURIComponent(oldAssetId)}`,
      "PUT",
      { assetId: newAssetId },
    );
  }

  detachAsset(bookmarkId: string, assetId: string): Promise<void> {
    return this.request<void>(
      `bookmarks/${encodeURIComponent(bookmarkId)}/assets/${encodeURIComponent(assetId)}`,
      { method: "DELETE" },
    );
  }
}

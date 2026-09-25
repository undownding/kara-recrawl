function extension(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

export function imageFileName(statusId: string, index: number, mime: string): string {
  const serial = String(index + 1).padStart(2, "0");
  return `weibo-${statusId}-image-${serial}.${extension(mime)}`;
}

export function screenshotFileName(statusId: string): string {
  return `weibo-${statusId}-screenshot.png`;
}

export function bannerFileName(statusId: string, index: number, mime: string): string {
  const serial = String(index + 1).padStart(2, "0");
  return `weibo-${statusId}-banner-${serial}.${extension(mime)}`;
}

export function imageAttachment(
  role: "original" | "repost",
  bookmarkStatusId: string,
  sourceStatusId: string,
  index: number,
  mime: string,
): { assetType: "bannerImage" | "bookmarkAsset"; fileName: string } {
  return role === "original"
    ? { assetType: "bannerImage", fileName: bannerFileName(sourceStatusId, index, mime) }
    : { assetType: "bookmarkAsset", fileName: imageFileName(bookmarkStatusId, index, mime) };
}

export function sanitizedChineseImageFileName(
  statusId: string,
  index: number,
  mime: string,
): string {
  const serial = String(index + 1).padStart(2, "0");
  return `__-${statusId}-__-${serial}.${extension(mime)}`;
}

export function legacyImageFileName(
  bookmarkId: string,
  key: string,
  url: string,
  mime: string,
): string {
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `weibo-${bookmarkId}-${safeKey || new URL(url).pathname.split("/").pop() || "image"}.${extension(mime)}`;
}

import { expect, test } from "bun:test";
import { bannerFileName, imageAttachment, imageFileName, screenshotFileName } from "../src/naming";

test("uses the status ID and image order in readable attachment names", () => {
  expect(imageFileName("5345913905089244", 0, "image/jpeg")).toBe(
    "weibo-5345913905089244-image-01.jpg",
  );
  expect(imageFileName("5345913905089244", 10, "image/png")).toBe(
    "weibo-5345913905089244-image-11.png",
  );
  expect(screenshotFileName("5345913905089244")).toBe("weibo-5345913905089244-screenshot.png");
  expect(bannerFileName("5345913905089244", 1, "image/jpeg")).toBe(
    "weibo-5345913905089244-banner-02.jpg",
  );
});

test("maps original and repost pictures to Karakeep asset types", () => {
  expect(imageAttachment("original", "3", "1", 0, "image/jpeg")).toEqual({
    assetType: "bannerImage",
    fileName: "weibo-1-banner-01.jpg",
  });
  expect(imageAttachment("repost", "3", "2", 0, "image/jpeg")).toEqual({
    assetType: "bookmarkAsset",
    fileName: "weibo-3-image-01.jpg",
  });
});

import { expect, test } from "bun:test";
import { singleFileMultipart } from "../src/karakeep";

test("SingleFile sends the exact HTML MIME type accepted by Karakeep", async () => {
  const form = singleFileMultipart(
    "https://m.weibo.cn/status/123",
    "<html>中文</html>",
    "reader.html",
  );
  const body = await form.body.text();
  expect(form.contentType).toMatch(/^multipart\/form-data; boundary=kara-recap-/);
  expect(body).toContain('name="url"\r\n\r\nhttps://m.weibo.cn/status/123');
  expect(body).toContain(
    'filename="reader.html"\r\nContent-Type: text/html\r\n\r\n<html>中文</html>',
  );
  expect(body).not.toContain("text/html;charset=utf-8");
});

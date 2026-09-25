# kara-recap

收到 Karakeep 的 `crawled` webhook 后，用 Bun + TypeScript 重新处理对应书签。目前支持 `m.weibo.cn/status/{id}`、`weibo.cn/status/{id}` 以及可解析到这些地址的微博分享链接。其他 URL 会跳过，不修改书签。

微博正文会生成便于阅读的 HTML，通过 SingleFile 接口回写为原书签的 `precrawledArchive`；顶层正文成为书签标题，全部正文进入描述。最内层原微博配图作为 `bannerImage`，转发链配图作为 `bookmarkAsset`，并附加网页截图。若 `KARAKEEP_DB_PATH` 指向可写的 Karakeep 数据库，服务还会将 HTML 归档设为 Reader 内容；路径未设置或文件不存在时跳过这一步。

## 配置 webhook

将 `.env.example` 复制成 `.env`，填写 `KARAKEEP_API_KEY` 和 `KARAKEEP_WEBHOOK_TOKEN`。`KARAKEEP_URL` 留空时使用官方云端地址，自托管时填服务器根地址。服务默认监听 `0.0.0.0:3000`，健康检查为 `GET /health`。

在 Karakeep 的 webhook 设置中，创建目标为 `http://<kara-recap主机>:3000/webhook` 的 webhook，只订阅 **`crawled`** 事件，并将其 token 设为与 `KARAKEEP_WEBHOOK_TOKEN` 相同的值。Karakeep 会发送 `Authorization: Bearer <token>`。若两个服务运行在不同容器中，请填 Karakeep 容器能访问的地址；`localhost` 通常指向 Karakeep 容器自身。Karakeep 默认阻止 worker 访问内网地址，TrueNAS 上使用内网 webhook 时，需在 **Karakeep 应用自身**配置 `CRAWLER_ALLOWED_INTERNAL_HOSTNAMES`，允许该目标主机名。服务器收到合法事件后立即返回 `202`，后台串行处理，并对处理失败的事件最多尝试三次。同一进程内按 webhook `jobId` 去重；进程重启会清空队列，失败详情见容器日志。

## Docker 运行

将镜像名替换为仓库的实际 GitHub 路径。每次 `main` 分支有新提交，GitHub Actions 会构建并推送 `ghcr.io/<owner>/<repo>:latest`，同时发布短 SHA 标签。也可本地构建：

```sh
docker build -t kara-recap:local .
docker run --rm --env-file .env -p 3000:3000 --shm-size=1g kara-recap:local
```

镜像包含 Chromium、Noto CJK 中文字体和 emoji 字体。要跳过截图，设置 `SKIP_SCREENSHOT=1`。若微博需要登录，可设置 `WEBVIEW_PROFILE_DIR` 并挂载持久浏览器资料目录；微博 JSON 接口如需登录，也可设置 `WEIBO_COOKIE`。请勿提交 `.env`。需要保留生成的 HTML 时，设置 `READER_OUTPUT_DIR=/output` 并挂载该目录。

### TrueNAS Reader 直写

你的 Karakeep ixVolume 位于 `/mnt/.ix-apps/app_mounts/karakeep/data`。在 `.env` 中设置：

```dotenv
KARAKEEP_DB_PATH=/mnt/.ix-apps/app_mounts/karakeep/data/db.db
```

在同一台 TrueNAS 主机上运行时，挂载整个目录，以便 SQLite 的 WAL 文件留在同一挂载点：

```sh
docker run --rm --network host --user 0:0 --env-file /你的/kara-recap/.env \
  --shm-size=1g \
  --mount type=bind,source=/mnt/.ix-apps/app_mounts/karakeep/data,target=/mnt/.ix-apps/app_mounts/karakeep/data \
  ghcr.io/<owner>/<repo>:latest
```

`--user 0:0` 适用于当前以 root 拥有数据文件的 TrueNAS 安装；若权限不同，使用对数据目录有写权限的 UID/GID。数据库路径不存在时，归档及附件仍会回写，只有 Reader 直写跳过。若后来在 Karakeep 中手动重新抓取，内置 Reader 内容可能再次覆盖生成的页面。

## 本地开发

需要 Bun 1.3.12 或更新版本、Chromium 和 Vite+ CLI。Linux 上可设置 `BUN_CHROME_PATH`。Bun 会在启动时读取 `.env`。

```sh
bun install
bun run start
bun test
bun run lint
bun run fmt
```

Karakeep 的 PATCH API 不提供 Reader HTML 字段，因此服务通过可选的本地 SQLite 路径设置 Reader。上传前会核对书签 URL、所有者和归档类型。重复事件会按附件文件名避免再次关联已存在的图片或截图。若上传成功而后续关联失败，Karakeep 中可能留下未关联资产。

已有归档需要单独补写 Reader 时，仍可设置 `RECAP_BOOKMARK_ID`、`KARAKEEP_DB_PATH` 和 `KARAKEEP_API_KEY`，执行 `bun run promote-reader`。

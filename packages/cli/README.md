# downcity

`downcity` 是 Downcity 的全局安装聚合包。

```bash
npm install -g downcity
downcity -v
```

安装后会得到 `city` / `downcity` 与 `fed` / `downfed` 两个相互独立的工具：

- `city` 是本机 City 容器，基于 `City()` 与 Agent SDK 管理全局 Agent、运行时、插件、chat 和控制台。
- `fed` 是 Federation Server Manager；TUI 用于注册和管理 Server，项目命令读取当前目录的 `federation.json`。Local Node.js 和 Cloudflare Workers 都通过 `fed deploy` 部署。

```bash
fed create ./my-fed
cd my-fed
pnpm install
fed deploy
fed
```

`fed create` 默认生成 Local Node.js + SQLite 项目。Local deploy 会自动注入并保存 admin key。无参数执行 `fed` 会进入系统级 Federation 管理面板，已部署实例不依赖当前工作目录。

为独立产品后端登记 Bureau：

```bash
fed bureau token
```

命令在 CLI 本地生成 `bureau_token`，Federation 只保存 hash，并将明文输出一次。把明文写入 Bureau 服务器的 `DOWNCITY_BUREAU_TOKEN` 环境变量；Federation 与 Bureau 不需要部署在同一台服务器。注册记录可用 `fed bureau list` 查看，使用 `fed bureau revoke <token_id>` 撤销。

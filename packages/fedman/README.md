# Fedman

Fedman 是 `fed web` 的 React 管理与数据分析前端。它只调用 CLI 暴露的同源 `/api/*`，
管理员通过 Federation 内置身份登录。密码不会保存，远端管理 Session 只存在于本地
`fed web` BFF 进程内，不会下发给浏览器。

## 开发

先启动本地 BFF，再启动 Vite：

```bash
fed web --no-open --port 43128
pnpm -C packages/fedman dev
```

开发页面位于 `http://127.0.0.1:43129`。Vite 只在开发期把 `/api` 转发到本地 BFF。

## 构建所有权

```text
packages/fedman/src
  → packages/fedman/dist
  → packages/cli/bin/federation/fedman
  → downcity npm package
```

`packages/fedman/dist` 是可重建产物，不提交；CLI build 会先构建 Fedman，再复制完整 dist。

# Worker Downtown

The Worker template explicitly creates `new Downtown({ database })` with the D1 binding Adapter. The isolate reuses its Downtown instance and forwards standard Requests to `downtown.fetch`. Service registration and database preparation belong to the host; the package root does not load a native SQLite driver.

Applications access the deployed service through `new Downtown({ url, user_token })` and the same `user` / `admin` APIs. These identities use independent credentials. Incoming Worker requests retain their own authorization; forwarding a request never inherits the host client's Token.

`trusted_identity` is a trusted in-process method argument. Do not construct it from request headers, query parameters, or bodies. `url` and `database` are mutually exclusive.

## 中文

此 Worker 模板显式传入 D1 binding Adapter，创建 `new Downtown({ database })`。同一 isolate 复用 Downtown，并将标准 Request 转发给 `downtown.fetch`。Service 注册和数据库准备由宿主负责；包根入口不加载原生 SQLite 驱动。

应用通过 `new Downtown({ url, user_token })` 访问已部署服务，使用相同的 `user` / `admin` API。两种身份的凭证相互独立；Worker 转发的请求使用自身身份，不会继承宿主客户端的 Token。

`trusted_identity` 只能由可信进程内方法参数提供，不能从 Header、查询参数或请求正文生成。`url` 与 `database` 互斥。

# Local Federation

The Node template explicitly creates `new Federation({ database })` with a SQLite Adapter, registers account and AI Services, and exposes `federation.fetch` through its HTTP host. Database paths and model credentials belong to the host configuration.

To embed the same service composition inside a Node application, pass the instance to `new City({ federation })`. Complete standard account login before calling user-authorized APIs. In-process `federation.user` and `federation.admin` calls use the runtime directly and require no listening port. User and admin credentials remain independent.

Close dependent Cities and stop the host's queue/background work before calling `federation.dispose()`. City borrows Federation and does not close its database.

Remote applications use `new Federation({ url, user_token })`. `url` and `database` are mutually exclusive. Database Adapters are explicit platform dependencies.

## 中文

此 Node 模板显式创建 SQLite Adapter，通过 `new Federation({ database })` 注册账户与 AI Service，再由 HTTP 宿主暴露 `federation.fetch`。数据库路径和模型凭证由宿主配置。

嵌入 Node 应用时，可将相同的服务组合交给 `new City({ federation })`。先完成标准账户登录，再调用用户业务 API。进程内 `user` 与 `admin` 请求直接进入运行时，无需监听端口，两种身份的凭证相互独立。

先关闭依赖它的 City、结束宿主队列及后台工作，再调用 `federation.dispose()`。远端应用使用 `new Federation({ url, user_token })`；`url` 与 `database` 互斥，数据库 Adapter 由平台显式提供。

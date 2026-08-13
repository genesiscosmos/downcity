# downcity

`downcity` 是 Downcity 的全局安装聚合包。

```bash
npm install -g downcity
downcity -v
```

安装后会得到 `city` / `downcity` 与 `fed` / `downfed` 两个相互独立的工具：

- `city` 是本机 Agent 宿主。CLI 通过数据库 Adapter 和 Repository 读取配置，显式创建 Agent，再由 City 按 ID 统一转发 HTTP/RPC。
- `fed` 是 Federation Server Manager；TUI 用于注册和管理 Server，项目命令读取当前目录的 `federation.json`。Local Node.js 和 Cloudflare Workers 都通过 `fed deploy` 部署。
- `fed web` 在 `127.0.0.1:43128` 启动当前 Federation 的本地 Web 管理 UI；管理员登录后的 Session 只保留在 CLI 本地 BFF 内存中。

```bash
fed create ./my-fed
cd my-fed
pnpm install
fed deploy
fed
```

`fed create` 默认生成 Local Node.js + SQLite 项目。首次 `fed deploy` 或 `fed deploy --admin-reset` 会交互式要求输入管理员 ID、密码和确认密码；密码至少 12 个字符，CLI 只在内存中使用明文并将摘要写入数据库。遗失密码时，只有拥有目标基础设施部署权限的人可以运行 `fed deploy --admin-reset`，非交互环境还必须显式传入 `--yes`（该参数只确认重置，不跳过凭证输入）。重置会撤销全部现有管理员 Session。CLI 通过本地 SQLite 事务或 Wrangler 远程 D1 权限直接完成管理员恢复，不要求 Worker 读取恢复环境变量；普通 deploy 永远不会修改管理员。部署期间会持续显示当前构建、资源准备、Worker 发布、健康检查与管理员验证阶段。无参数执行 `fed` 会进入系统级 Federation 管理面板，已部署实例不依赖当前工作目录。

City 的主要命令：

```bash
city agent create .
city on
city status
city agent chat <agent_id>
city agent token create <agent_id> --name local
city plugin action <plugin_name> <action_name> <agent_id> --input '{}'
```

CLI 从本地产品配置装配的 Agent 默认启用 `ask_question` Tool。使用
`city agent chat <agent_id>` 交互时，模型可以在缺少关键信息时显示文本、单选或多选问题；
回答会通过 Session Interaction 提交，并在同一轮模型执行中继续处理。

Agent、Workspace 与 Plugin Binding 统一保存在 `~/.downcity/downcity.db`。每个持久化 Agent 对应一个 Workspace；一个 Workspace 可以被多个 Agent 使用。CLI daemon 和 Desktop 各自创建独立的 City 实例，启动、停止和 HTTP/RPC 生命周期互不共享。Session 仍保存在实际 Workspace 的 `.downcity/agents/<agent_id>/sessions/` 下。`city agent chat` 在 CLI City 运行时走 RPC，City 停止时创建临时本地 Agent，退出后立即释放。

CLI City 只维护一个 daemon，并分别监听一个 HTTP 端口和一个原生 TCP RPC 端口。两种协议都按 `agent_id` 路由，不为每个 Agent 分配独立端口。

Federation Admin 配置与 Embassy User Session 同样保存在 `~/.downcity/downcity.db`。升级后，CLI 会把旧 `~/.downcity/federation.db` 中的管理配置一次性迁入统一数据库；旧文件保留用于人工恢复，但后续不再读取。脚本可通过 `DOWNCITY_FEDERATION_URL` 和 `DOWNCITY_USER_TOKEN` 显式覆盖当前 Embassy 用户身份。

为独立产品后端登记 Bureau：

```bash
fed bureau token
```

命令打开 Bureau Token 交互式管理界面，可签发、查看和撤销 Token。签发时必须先登录 Federation Admin 并输入用途，也可以直接运行 `fed bureau token issue <bureau_id>`。CLI 不生成凭证；它请求 Federation 生成明文、保存 hash，并将明文返回一次。把明文写入 Bureau 业务服务的 `DOWNCITY_BUREAU_TOKEN` 环境变量。脚本中可用 `fed bureau token list` 查看元数据，使用 `fed bureau token revoke <token_id>` 撤销。Bureau Token 不能签发 User Token。

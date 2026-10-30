# downcity

`downcity` 是 Downcity 的全局安装聚合包。

```bash
npm install -g downcity
downcity -v
```

安装后会得到 `city` / `downcity` 与 `fed` / `downfed` 两个相互独立的工具：

- `city` 是本机 Agent 宿主。CLI 通过数据库 Adapter 和 Repository 读取配置，显式创建 Agent，再由 City 按 ID 统一转发 HTTP/RPC。
- `fed` 是 Federation Server Manager；TUI 用于注册和管理 Server，项目命令读取当前目录的 `federation.toml`，项目配置只支持 TOML，不兼容 JSON 配置。Local Node.js 和 Cloudflare Workers 都通过 `fed deploy` 部署。
- `fed web --id fed_x` 在 `127.0.0.1:43128` 启动本次指定 Federation 的本地 Web 管理 UI；管理员登录后的 Session 只保留在 CLI 本地 BFF 内存中。

```bash
fed create --path ./my-fed
cd my-fed
pnpm install
fed deploy
fed
```

`fed create` 和 `fed deploy` 的 `--path` 默认是 `.`；指定其他目录时使用 `--path <path>`，不接受位置路径参数，例如 `fed deploy --path ./my-fed`。

Fed 没有全局 active/default Federation，也不保存 `active_server_url`。`stop`、`restart`、`status`、`logs`、`query`、`web`、`server`、`manage` 与 `server manage` 使用互斥的 `--id <id>` 或 `--name <name>`，ID 和名称均精确匹配。省略选择参数时，TTY 显示列表，选择只用于本次操作；非交互环境缺少参数时报错。名称重名时，TTY 继续选择，非 TTY 报错。列表没有表示全局当前连接的星标。`fed manage --id fed_x` 直接进入目标管理工作区，不接受 action 位置参数；`fed server manage --id fed_x` 也支持同样的选择规则。

```bash
fed status --id fed_x
fed logs --id fed_x
fed stop --id fed_x
fed restart --id fed_x
fed query GET /health --name my-fed
fed manage --id fed_x
fed server manage --id fed_x
fed web --id fed_x --no-open
```

`status` 可查询任意已保存连接，展示 registry record 与 `/health` 实时探测结果；本地实例还单独显示 launchd/systemd manager 状态。登记记录、系统服务状态和健康探测是独立信息。本地 release 的健康检查要求响应 `ok: true`，且 `fed_id`、`release_id`、`instance_id` 全部匹配受管实例，HTTP 200 本身不足以确认身份。`logs`、`stop` 和 `restart` 仅支持 CLI 管理的 local 实例。`logs` 读取现有 `service.log` 的最近日志。`stop` 禁用自动启动并停止服务，停止状态跨系统重启保留，直到用户显式执行 `fed deploy` 或 `fed restart`；这些操作按持久配置恢复自动启动策略。`restart` 只运行已安装的 release，读取持久运行配置，不读取源码或重新构建；原项目目录删除后仍可重启。重启还要求 `current.json` 与 registry 的 release 一致；失败候选与 current 不一致时直接报错，不隐式回滚。管理界面的 Remove connection 只移除连接，不停止服务。

本地独立 Node 发布模型将编译后的入口、完整生产依赖及项目资源安装到 `~/.downcity/federation/deployments/<fed_id>/releases/<release_id>`，同级 `current.json` 记录当前 release。项目资源通过 `package.json.files` 显式声明；生产依赖及其运行资源完整纳入产物，`.env` 不进入产物。`deployment.scripts.build` 保留用于构建，本地目标拒绝 `deployment.scripts.deploy`，Node 直接运行编译后的入口。默认使用系统 Node，运行时必须与构建时的 Node 版本、平台和架构一致，尤其是含原生模块的依赖。

运行配置单独保存在 `~/.downcity/federation/config/<fed_id>/runtime.env.json`，文件权限为 `0600`。默认 SQLite 位于 `~/.downcity/federation/data/<fed_id>/data.sqlite`。显式指定的数据库保持其绝对路径；删除源码前需确认数据库不在准备删除的目录内。已登记的数据库文件缺失时直接报错，拒绝创建空库替代；没有显式路径但源码目录中存在 `data.sqlite` 或 `data/local.db` 时，要求在项目 `.env` 中显式声明数据库路径，不猜测或迁移。`fed deploy --dry-run` 在临时目录构建和校验产物并清理，不安装 release、不修改持久运行配置、不启停实例；构建脚本仍可能向项目写入构建输出。

操作锁的 owner 已失效或没有 owner 时，CLI 只报告锁路径并要求人工核对，不自动回收锁。

本地部署使用 macOS 用户级 launchd 或 Linux 用户级 systemd。进程策略在 `federation.toml` 中配置，Local 模板显式生成以下默认值：

```toml
[deployment.process]
auto_start = false
restart_on_failure = true
```

`deployment.process` 只适用于 `local`；省略表或字段时读取器补齐默认值。两个字段只接受布尔值，未知字段报错；Cloudflare Workers 配置此表时报错。修改项目配置后执行 `fed deploy` 应用，`fed restart` 使用持久运行配置。

`restart_on_failure` 默认开启，异常退出后每隔 10 秒尝试恢复，60 秒内最多 5 次；主动停止不触发恢复。`auto_start` 默认关闭，只有显式设为 `true` 才持久安装到 macOS 的 `~/Library/LaunchAgents` 或启用 Linux 用户级 `default.target.wants`。macOS 在用户登录后自动启动；Linux 需要该用户的 systemd user manager 已存在并可用，不能据此保证开机启动。CLI 不自动开启 linger。

系统服务定义只引用启动入口及运行配置路径，不包含 secret；运行配置独立保存于上述 `runtime.env.json`。部署目标为 `local` 或 `cloudflare-workers`；远程主机需在目标机器运行本地部署命令。

本地部署未设置 `deployment.port` 时固定使用默认端口 `12314`；在 `federation.toml` 的 `[deployment]` 中显式设置 `port` 可覆盖默认值。选定端口被占用时部署直接报错，不扫描其他端口，也不从部署历史推断端口。

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

CLI 从本地产品配置装配的 Agent 默认启用 `ask_user` Tool。使用
`city agent chat <agent_id>` 交互时，模型可以在缺少关键信息时显示文本、单选或多选问题；
回答会通过 Session Interaction 提交，并在同一轮模型执行中继续处理。
私密问题使用 `type: "secret"` 与 snake_case `name`；本地 Session 使用遮蔽输入和专用提交方法，
提交前确认私密值数量、名称及覆盖同名值。明文只保存在当前 Session 内存中，释放或重启后丢失。
缺少专用私密提交接口的远程传输会拒绝收集私密表单，请使用 Desktop 或本地 Session。

Agent 定义保存在 `~/.downcity/agents/<agent_id>/agent.json`，主体指令保存在同目录的 `SOUL.md`。Plugin 以稳定 ID 使用 `~/.downcity/plugins/<plugin_id>/`，每个 Plugin 的唯一明文配置位于自己的 `config.toml`。第三方 Plugin 的安装目录只保留唯一 `plugin.json`、建立 ESM 边界的 `package.json` 与自包含入口，不保留源码和构建配置。Plugin 运行时状态和缓存由宿主放入 `~/.downcity/agents/<agent_id>/plugins/<plugin_id>/`，不写入 Plugin 配置目录，也不按 Workspace 复制。`downcity.db` 只保存 Workspace 索引、Token 与平台状态。Agent 与 Workspace 不绑定，同一个 Agent 可以进入多个 Workspace；Agent 不保存 Plugin 引用，City 自动把全部已注册 Plugin 和同一份配置提供给所有 Agent。CLI daemon 和 Desktop 各自创建独立的 City 实例，加入 City 后，Agent 的 Session 状态统一保存在 `~/.downcity/agents/<agent_id>/sessions/<session_id>/`；未加入 City 时只保存在当前 Agent 实例内存中。Workspace 只在 Session 的 `meta.json` 中作为可选 `workspace_id` 记录，项目目录不创建 `.downcity`。

CLI City 只维护一个 daemon，并分别监听一个 HTTP 端口和一个原生 TCP RPC 端口。两种协议都按 `agent_id` 路由，不为每个 Agent 分配独立端口。

Federation Admin 配置与 Embassy User Session 同样保存在 `~/.downcity/downcity.db`。脚本可通过 `DOWNCITY_FEDERATION_URL` 和 `DOWNCITY_USER_TOKEN` 显式覆盖当前 Embassy 用户身份。

为独立产品后端登记 Bureau：

```bash
fed bureau token --id fed_x
```

Bureau Token 命令同样按本次操作选择 Federation，支持互斥的 `--id` / `--name`，也可把参数放在 `token` 父命令上，例如 `fed bureau token --id fed_x list`；省略参数、重名和非交互报错规则同上。命令打开 Bureau Token 交互式管理界面，可签发、查看和撤销 Token。签发时必须先登录 Federation Admin 并输入用途，也可以直接运行 `fed bureau token --id fed_x issue <bureau_id>`。CLI 不生成凭证；它请求 Federation 生成明文、保存 hash，并将明文返回一次。把明文写入 Bureau 业务服务的 `DOWNCITY_BUREAU_TOKEN` 环境变量。脚本中可用 `fed bureau token --id fed_x list` 查看元数据，使用 `fed bureau token --id fed_x revoke <token_id>` 撤销。Bureau Token 不能签发 User Token。

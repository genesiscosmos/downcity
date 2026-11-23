# downcity

`downcity` 是 Downcity 的全局安装聚合包。

```bash
npm install -g downcity
downcity -v
```

安装后会得到 `city` / `downcity` 与 `downtown` 两个相互独立的工具：

- `city` 是本机 Agent 宿主。CLI 通过数据库 Adapter 和 Repository 读取配置，显式创建 Agent，再由 City 按 ID 统一转发 HTTP/RPC。
- `downtown` 是 Downtown Server Manager；TUI 用于注册和管理 Server，项目命令读取当前目录的 `downtown.toml`，项目配置只支持 TOML，不兼容 JSON 配置。Local Node.js 和 Cloudflare Workers 都通过 `downtown deploy` 部署。
- `downtown web --id fed_x` 在 `127.0.0.1:43128` 启动本次指定 Downtown 的本地 Web 管理 UI；管理员登录后的 Session 只保留在 CLI 本地 BFF 内存中。

```bash
downtown create --path ./my-fed
cd my-fed
pnpm install
downtown deploy
downtown
```

`downtown create` 和 `downtown deploy` 的 `--path` 默认是 `.`；指定其他目录时使用 `--path <path>`，不接受位置路径参数，例如 `downtown deploy --path ./my-fed`。

Fed 没有全局 active/default Downtown，也不保存 `active_server_url`。`stop`、`restart`、`clean`、`backup`、`restore`、`status`、`logs`、`query`、`web`、`server`、`manage` 与 `server manage` 使用互斥的 `--id <id>` 或 `--name <name>`，ID 和名称均精确匹配。省略选择参数时，TTY 显示列表，选择只用于本次操作；非交互环境缺少参数时报错。名称重名时，TTY 继续选择，非 TTY 报错。列表没有表示全局当前连接的星标。`downtown manage --id fed_x` 直接进入目标管理工作区，不接受 action 位置参数；`downtown server manage --id fed_x` 也支持同样的选择规则。

```bash
downtown status --id fed_x
downtown logs --id fed_x
downtown stop --id fed_x
downtown restart --id fed_x
downtown clean --id fed_x --dry-run
downtown clean --name my-fed --yes
downtown query GET /health --name my-fed
downtown manage --id fed_x
downtown server manage --id fed_x
downtown web --id fed_x --no-open
```

`status` 可查询任意已保存连接，分别展示 registry record、系统 manager 事实与 `/health` 实时探测；本地实例另展示发布历史。登记状态、保存的策略和发布结果都不证明服务已停止或某个 release 正在运行。本地 release 只有在 manager 核对实例身份，且健康响应为 `ok: true`、`fed_id`、`release_id`、`instance_id` 全部匹配时才显示 ready；HTTP 200 本身不足以确认身份。manager 检查异常显示 `unknown`，需要人工检查系统服务与健康端点。

`logs`、`stop` 和 `restart` 仅支持 CLI 管理的 local 实例。`logs` 显示当前 `service.log` 末尾最多 200 行，不跨文件补足；归档可人工读取。`stop` 禁用自动启动并停止服务，停止状态跨系统重启保留，直到用户显式执行 `downtown deploy` 或符合恢复保护要求的 `downtown restart`；这些操作按持久配置恢复自动启动策略。`restart` 只运行已安装 release，读取持久运行配置，不读取源码或重新构建；原项目目录删除后仍可重启。重启还要求 `current.json` 与 registry 的 release 一致。切换前的 build/package/preflight 失败保留旧实例及运行配置；没有待恢复切换时，允许 restart 原成功 release。进入切换后设置 `recovery_required = true`；切换失败或中断时阻断 restart，恢复必须显式执行 `downtown deploy` 并成功。此保护持续到发布成功，后续 build/preflight 失败也不会清除。历史 `last_failure` 本身不构成阻断。管理界面的 Remove connection 只移除连接，不停止服务。

## 本地 SQLite 备份与恢复

```bash
downtown backup --id fed_x
downtown stop --id fed_x
downtown restore --id fed_x --path /absolute/path/to/backup_id --dry-run
downtown restore --id fed_x --path /absolute/path/to/backup_id
# 非交互环境明确授权替换
downtown restore --name my-fed --path /absolute/path/to/backup_id --yes
```

仅支持已登记独立 release 的本地 SQLite 数据库，路径来自持久运行配置的绝对 `DATABASE_PATH`。在线备份使用 SQLite backup API，包含 WAL，完成后校验完整性、大小和 SHA-256；备份目录位于 `~/.downcity/downtown/backups/<fed_id>/<backup_id>/`，包含 `database.sqlite` 和完成标记 `backup.json`，权限分别为目录 `0700`、文件 `0600`。

恢复必须先显式 `downtown stop`，并核对系统服务已停止、无法自动恢复及自启关联已关闭。先为当前数据库创建安全备份，再预览确认；取消不替换数据库，`--dry-run` 不生成安全备份或改库。确认后再次校验输入和当前库变化，在同目录准备文件、收敛 WAL，再原子替换；服务保持停止，不切换 release、运行配置或 City 连接。同 Fed 锁排除并发部署与启停，不控制绕过 Fed 的外部数据库连接。

备份可能包含用户信息、会话和凭据，不能提交 Git 或打入 release；摘要不等于加密或签名。恢复不保证 schema 跨版本兼容，也不自动回滚或迁移应用，恢复后管理员 Session 与 User Token 可能需重新登录。备份不自动定时或清理，`downtown clean` 不删除它们。完整边界见 [SQLite 备份与恢复](https://downcity.ai/zh/city-sdk-docs/packages/cli/backup-and-restore)。

本地受管日志使用固定默认值，无需新增配置：

| 文件 | 单份上限 | 归档 | 每个 Fed 的文件总额度 |
| --- | --- | --- | --- |
| `service.log` | 20 MiB | 5 份，`.1` 最新、`.5` 最旧 | 约 120 MiB，含当前文件 |
| `supervisor.log` | 2 MiB | 3 份，`.1` 最新、`.3` 最旧 | 约 8 MiB，含当前文件 |

应用 stdout 和 stderr 经 runner 的 pipe 与背压串行写入 `service.log`，避免无限排队。按实际字节切分，单个巨大 chunk 也不会让任何一份超限；文件边界不保证 UTF-8 字符或行完整。轮转不重启服务。写入失败时 runner 停止应用，将运行 receipt 标记为 `failed`。

`supervisor.log` 由 runner 写入固定、安全的诊断 event/code，不记录正文、Token、密钥或完整环境变量。macOS launchd 的 stdout/stderr 指向 `/dev/null`；Linux 的固定事件同样写入该文件，system journal 另保留 runtime 启动信息，其额度与轮转由操作系统管理，CLI 不修改全局 journal 配置。Node 在进入 runner 前启动失败时，需通过 `launchctl` 或 `systemctl --user` / `journalctl --user` 诊断。

writer 的当前日志和归档路径必须是普通文件；符号链接、目录等非法目标会被拒绝，不跟随链接。已存在且超过对应单份上限的文件会报错，不会截断；用户需先明确归档或清理。应用主动输出不保证自动脱敏，应用开发者不得记录 Token、API key 或完整请求/响应正文。这些规则描述包含该功能的 CLI，文档更新不代表运行实例已经应用。

本地独立 Node 发布模型将编译后的入口、完整生产依赖及项目资源安装到 `~/.downcity/downtown/deployments/<fed_id>/releases/<release_id>`，同级 `current.json` 是成功激活指针，不代表该 release 当前正在运行。项目资源通过 `package.json.files` 显式声明；生产依赖及其运行资源完整纳入产物，`.env` 不进入产物。`deployment.scripts.build` 保留用于构建，本地目标拒绝 `deployment.scripts.deploy`，Node 直接运行编译后的入口。默认使用系统 Node，运行时必须与构建时的 Node 版本、平台和架构一致，尤其是含原生模块的依赖。

本地 Node 发布按阶段处理失败，不自动回滚代码或数据库，也没有 `rollback` 命令。以下规则仅适用于 `local` Node，不适用于 Cloudflare Workers：

| 阶段 | 失败后的处理 |
| --- | --- |
| build / package / validate / install / preflight | 保留旧实例及持久运行配置，不进入切换。 |
| stop | 不启动候选，避免竞争实例；必须检查 manager 与健康端点确认实际状态。 |
| prepare | 旧服务停止后才提交配置、初始化数据库及迁移；失败不启动候选，不自动回滚代码或数据库。 |
| start / ready | 停止候选并移除自动启动关联；清理确认成功记为 `stopped`，异常记为 `unknown`。原始发布错误和清理错误都会报告；`unknown` 要求人工检查服务、自启关联和健康端点，不能宣称服务已停止。 |

发布摘要保存在 `~/.downcity/downtown/deployments/<fed_id>/deployment.json`。`status` 展示最后成功 release、最近失败 release 和失败阶段，以及 `latest` 的 release、outcome、phase、cutover、candidate、cleanup 与 `recovery required`。未形成候选 release 时显示 `not produced`；没有历史时单独显示未记录。`last_success` 不被失败覆盖，`last_failure` 与 `latest` 分别显示；`cleanup` 是该次尝试的清理结果，不是实时服务状态。记录缺失或损坏也不替代 manager 与健康检查。

`downtown clean` 仅清理本地已登记 Fed 的 release。使用互斥且精确匹配的 `--id <id>` 或 `--name <name>`；省略时，TTY 从列表选择一个 Fed，选择仅用于本次操作，非 TTY 直接报错。名称重名时，TTY 继续选择，非 TTY 报错。它不清理远程连接或未登记目录。

```bash
downtown clean                              # TTY 列表选择后预览、确认
downtown clean --id fed_x --dry-run          # 只预览
downtown clean --name my-fed                 # 预览后交互确认
downtown clean --id fed_x --yes              # 显式确认，适用于非交互调用
```

清理先预览各 release 的 ID、大小及删除或保留原因，再确认删除。`--dry-run` 只预览，不删除；非交互删除必须显式传入 `--yes`，该参数不绕过保护检查。默认始终保留最近 3 个成功 release，不开放 `--keep` 参数。以下 release 同样受保护：

- 成功激活指针 `current.json` 或 registry 引用的 release。
- 服务 `launch.json` 引用的 release，包括处于恢复待运行状态的引用。
- 进行中发布尝试引用的 release，以及候选清理结果无法确认的 release。
- 未知、损坏或没有可信发布记录的 release；预览会解释保留原因。

运行器不可验证或其他保护信息检查出错时，直接拒绝清理。同一 Fed 的操作锁在目标选择后覆盖预览、确认与删除全过程，阻止并发切换改变引用。

发布尝试保存在 `~/.downcity/downtown/deployments/<fed_id>/attempts/<operation_id>.json`，用于识别成功与失败历史。失败产物仅由用户手动执行 `downtown clean` 删除，仍须通过上述保护检查。CLI 不自动清理 release；`clean` 不删除 data、config、logs、staging 或部署历史，release 删除后发布尝试记录和发布摘要仍保留。

运行配置单独保存在 `~/.downcity/downtown/config/<fed_id>/runtime.env.json`，文件权限为 `0600`。默认 SQLite 位于 `~/.downcity/downtown/data/<fed_id>/data.sqlite`。显式指定的数据库保持其绝对路径；删除源码前需确认数据库不在准备删除的目录内。已登记的数据库文件缺失时直接报错，拒绝创建空库替代；没有显式路径但源码目录中存在 `data.sqlite` 或 `data/local.db` 时，要求在项目 `.env` 中显式声明数据库路径，不猜测或迁移。`downtown deploy --dry-run` 在临时目录构建和校验产物并清理，不安装 release、不修改持久运行配置、不启停实例；构建脚本仍可能向项目写入构建输出。

操作锁的 owner 已失效或没有 owner 时，CLI 只报告锁路径并要求人工核对，不自动回收锁。

本地部署使用 macOS 用户级 launchd 或 Linux 用户级 systemd。进程策略在 `downtown.toml` 中配置，Local 模板显式生成以下默认值：

```toml
[deployment.process]
auto_start = false
restart_on_failure = true
```

`deployment.process` 只适用于 `local`；省略表或字段时读取器补齐默认值。两个字段只接受布尔值，未知字段报错；Cloudflare Workers 配置此表时报错。修改项目配置后执行 `downtown deploy` 应用，`downtown restart` 使用持久运行配置。

`restart_on_failure` 默认开启，异常退出后每隔 10 秒尝试恢复，60 秒内最多 5 次；主动停止不触发恢复。`auto_start` 默认关闭，只有显式设为 `true` 才持久安装到 macOS 的 `~/Library/LaunchAgents` 或启用 Linux 用户级 `default.target.wants`。macOS 在用户登录后自动启动；Linux 需要该用户的 systemd user manager 已存在并可用，不能据此保证开机启动。CLI 不自动开启 linger。

系统服务定义只引用启动入口及运行配置路径，不包含 secret；运行配置独立保存于上述 `runtime.env.json`。部署目标为 `local` 或 `cloudflare-workers`；远程主机需在目标机器运行本地部署命令。

本地部署未设置 `deployment.port` 时固定使用默认端口 `12314`；在 `downtown.toml` 的 `[deployment]` 中显式设置 `port` 可覆盖默认值。选定端口被占用时，交互终端会展示占用进程的 PID、启动时间、命令和工作目录，并标明是否属于当前项目，询问是否停止后继续部署（默认否）。确认后 CLI 重新核对进程身份，发送 `SIGTERM` 并最多等待 5 秒释放端口，不自动强制终止。非交互终端、无法核实进程身份或端口未释放时部署失败；`--yes` 不跳过停止进程的确认。进程检查需要系统提供 `lsof` 和 `ps`。CLI 不扫描其他端口，也不从部署历史推断端口。

`downtown create` 默认生成 Local Node.js + SQLite 项目。首次 `downtown deploy` 或 `downtown deploy --admin-reset` 会交互式要求输入管理员 ID、密码和确认密码；密码至少 12 个字符，CLI 只在内存中使用明文并将摘要写入数据库。遗失密码时，只有拥有目标基础设施部署权限的人可以运行 `downtown deploy --admin-reset`，非交互环境还必须显式传入 `--yes`（该参数只确认重置，不跳过凭证输入）。重置会撤销全部现有管理员 Session。CLI 通过本地 SQLite 事务或 Wrangler 远程 D1 权限直接完成管理员恢复，不要求 Worker 读取恢复环境变量；普通 deploy 永远不会修改管理员。部署期间会持续显示当前构建、资源准备、Worker 发布、健康检查与管理员验证阶段。无参数执行 `downtown` 会进入系统级 Downtown 管理面板，已部署实例不依赖当前工作目录。

City 的主要命令：

```bash
city agent create --name Reviewer --id reviewer --model MODEL_ID
city workspace register ./project --name Project
city workspace list --json
city agent get reviewer --json
city agent update reviewer --model MODEL_ID --if-revision HASH
city on
city status
city session create --agent reviewer --workspace WORKSPACE_ID --json
city session history SESSION_ID --agent reviewer --include-internal --json
city session send SESSION_ID --agent reviewer --message "Review" --request-id REQUEST_ID --no-wait --json
city session stop SESSION_ID --agent reviewer --turn-id TURN_ID
city session archive SESSION_ID --agent reviewer
city agent chat reviewer --new-session --workspace WORKSPACE_ID
city token create --name local --agents reviewer --never-expires
```

CLI 从本地产品配置装配的 Agent 默认启用 `ask_user` Tool。使用
`city agent chat <agent_id>` 交互时，模型可以在缺少关键信息时显示文本、单选或多选问题；
回答会通过 Session Interaction 提交，并在同一轮模型执行中继续处理。
私密问题使用 `type: "secret"` 与 snake_case `name`；本地 Session 使用遮蔽输入和专用提交方法，
提交前确认私密值数量、名称及覆盖同名值。明文只保存在当前 Session 内存中，释放或重启后丢失。
缺少专用私密提交接口的远程传输会拒绝收集私密表单，请使用 Desktop 或本地 Session。

Agent 定义保存在 `~/.downcity/agents/<agent_id>/agent.json` 和 `SOUL.md`；创建独立于项目登记，不初始化项目资产。`downcity.db` 保存 Workspace、Token 和平台状态，Power 使用 `powers/<power_id>/config.toml`。Session 属于 Agent，地址包含 Agent/category/Session ID。项目登记缺失时历史仍可读，执行拒绝。默认配置更新作用于新 Session，保留已有快照与覆盖。

CLI 与 Desktop 在同一 root 下互斥持有执行权，资源命令连接经核对的当前宿主；不自动启动或接管宿主。无宿主可配置管理和无副作用历史浏览，执行、创建、停止和归档 Session 需要显式启动。资源命令支持 `--root`、`--json`、`--timeout`；JSON stdout 为单个 schema_version=1 envelope，含 success/command/data/error/meta。退出码：0 成功、1 内部错误、2 参数、3 不存在、4 冲突、5 宿主/能力、6 权限、7 超时、8 Turn 失败/停止、9 部分失败、130 取消。`--no-wait` 后执行由宿主持有，超时/客户端退出不停止 Turn。

`city agent delete ID --yes` 永久删除 Agent 自有 scope（含 Session/归档/附件/skills/日志/Power 数据），有工作或强引用时拒绝。`city workspace remove ID --yes` 只移除登记和空闲运行资源，保留工程与历史。完整说明见 [资源管理](https://downcity.ai/zh/docs/cli/resources)。

CLI City 只维护一个 daemon，并分别监听一个 HTTP 端口和一个原生 TCP RPC 端口。两种协议都按 `agent_id` 路由，不为每个 Agent 分配独立端口。

Downtown 连接与独立账户凭据保存在当前 City root 的本地数据库中。使用连接 ID 显式选择服务：

```sh
city downtown add https://base.downcity.ai --name Official
city downtown list
city downtown login <connection_id>
city downtown whoami <connection_id>
city downtown models --connection <connection_id>
city downtown services --connection <connection_id>
city downtown logout <connection_id>
```

每条连接独立登录，模型和服务保留来源 ID；不设置全局当前连接。账户用量由原 Downtown 记录，City 的来源标签不授予权限。独立的 `downtown deploy` 管理服务端部署，`city downtown` 管理 City 连接。

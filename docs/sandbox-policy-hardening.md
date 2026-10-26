# 原生 Sandbox 文件边界优化

本轮统一原生文件权限语义并修复平台执行缺口，保留现有 Provider → WorkspaceSandbox → launcher 职责分层。

## 生效规则

原生后端采用宿主可读、写入白名单模型。规则统一为 `filesystem_rules`，能力为 `read`、`write`、`deny`。同一路径按 `deny > read > write` 合并；只读与拒绝子树不会被其他写授权重新开放。这是有意采用的保守语义，不支持在只读或拒绝父树下重新开放可写子目录。

macOS 为写规则生成 allow，为只读规则生成显式 write deny，为受保护规则生成 read/write deny。Linux 从只读宿主根开始，开放可写目录，再覆盖只读与拒绝路径。`/dev`、`/proc` 使用独立实例，不重新挂载宿主设备树。Linux 通过空目录或空文件挂载隐藏受保护内容，因此拒绝路径未必返回读取错误，但不能读到宿主原始内容。

所有策略路径解析现存祖先的真实路径，避免 macOS `/var`、`/tmp` 等别名导致规则失效。Linux 在可写根内遇到不存在且无法安全落实的限制路径时拒绝执行。当前不承诺抵御策略构建与进程启动间的恶意并发路径替换。

## 自省与错误解释

`WorkspaceSandboxSnapshot` 和 `context.sandbox.get` 增加必填 `denied_write_paths`。调用方必须先检查写入排除项，再检查 `writable_roots`；单独使用可写根列表无法描述只读子树。

City 的路径解释及原生权限错误解释均识别只读、受保护路径。City 路径解释仍是词法判断，不是 OS 实际权限探测；使用与快照一致的真实路径获得更准确结果。

`spawn()` 用传给子进程的环境生成平台包装，避免 SSH socket 策略引用其他环境快照。该变更不等于凭证环境清理。

## 自检

Provider.check 使用自有临时文件检查工作区写入、工作区外写入、可写父树内的只读子树、受保护内容以及子进程限制继承。探针使用位置参数传递路径，不把文件路径直接插入 Shell 命令。每个探针限制为五秒，超时终止进程组；启动失败、信号退出及超时不能冒充预期拒绝。

已有原生契约与 Doctor 测试 25 项通过，City 的 Workspace/Shell 集成测试 5 项通过；type、native、city 构建及 microsandbox 类型检查通过。macOS 宿主真实自检在 network=allow 和 network=deny 配置下均通过，覆盖上述文件隔离行为及 TCP 到宿主 loopback 的网络边界。嵌套 Seatbelt 执行会被系统拒绝，因此真实自检必须在外层宿主执行。

网络自检在宿主启动自有 loopback TCP 服务，先以 allow 策略确认随机令牌可达，再以 deny 策略验证同一端点被拦。探针使用当前 Node 可执行文件，不依赖 curl、Python 或外网。仅明确的权限或网络命名空间拒绝错误可以通过；超时、Node 启动失败与未知连接错误均失败。这不等于 UDP、Unix socket、IPv6 或域名代理验收。

Provider.check 发生临时目录、路径解析或包装异常时返回 `ok: false` 与 `canary_failed`，便于装配层展示失败。`native-canary.mjs` 在 Provider 不可用时立即退出，任何验证失败均返回非零退出码，避免 CI 将失败报告视为成功。

Linux 已在 Colima VM 中实跑：内核 `6.8.0-64-generic`、Bubblewrap `0.9.0`、Node `18.19.1`。Bubblewrap 启动命令返回 0，network=allow 与 network=deny 两组 Provider.check 均返回 `ok: true`、`issues: []`，原生契约与 Doctor 的 25 项现有测试全部通过。覆盖工作区写入、越界写入拒绝、可写根内只读覆盖、受保护内容遮蔽、子进程继承及 TCP loopback 边界。随后使用官方 Node `22.23.4` Linux ARM64 归档完成受支持版本复验：下载内容与同源 SHASUMS256.txt 校验一致，network=allow 与 network=deny 两组真实自检均返回 `ok: true`、`issues: []`，同一组 25 项现有测试全部通过。Node 22 仅在 VM 自有临时目录中运行，复验结束后清理，未替换系统 Node。此结果补齐受支持 Node 版本下的原生后端验证，不代表完整 CLI/Desktop、PTY、所有网络协议及发布流程均已验收。

该 VM 启用了 `kernel.apparmor_restrict_unprivileged_userns=1`，首次启动报 `bwrap: setting up uid map: Permission denied`。用户在 VM 添加并加载了 `/etc/apparmor.d/downcity-bwrap`：对 `/usr/bin/bwrap` 使用 `flags=(unconfined)` 并授权 `userns`，随后自检通过。全局内核限制未关闭。此配置是验收环境前提，不由 Sandbox 自动安装或提升权限。

## 后续范围

已增加原生启动边界的环境变量 scrub：按名称移除 token、secret、password、API key、credential 路径与 SSH agent 变量；宿主通过 `allowed_credential_env` 精确授权例外，Downcity 内部令牌始终移除。PATH、HOME、AWS_REGION 等非凭证配置保留；规则不检测值、不记录秘密、不更改调用方快照。假凭证启动器检查已验证默认移除、显式授权、内部令牌不可授权和包装器使用清理后的 SSH socket 视图。原生构建及 25 项现有测试通过。

该清理不是完整凭证隔离：login 配置和可读宿主文件仍可能重新加载凭证，未知名称也无法识别。实际 Git/包管理器认证流程还需要凭证代理。

启动就绪检查已统一到 Shell 持有的 WorkspaceSandbox.spawn 入口，工具执行与 SDK 短命令都会先等待 Provider.check。并发启动共享一次 Promise，失败或异常保持缓存，后续命令继续拒绝；成功 reset 后清除缓存，下次启动重查。不支持 reset 的 Provider 需要重建 Shell/Workspace。reset 期间拒绝新启动，reset 失败保持拒绝直至重试成功。dispose 在异步清理前标记关闭，等待在途检查与启动任务收口，再关闭 Shell Sessions 和停止 Sandbox；等待检查的命令在启动前再次核对释放与 reset 状态。host 执行仍由审批链控制，不因自检失败自动触发。

City 构建和 5 项现有 Workspace/Shell 集成测试通过；受控 Provider 运行检查验证了并发单次自检、失败缓存、reset 后重试，以及自检期间 dispose 后不再 spawn。此次没有把 Provider.check 当作每条命令实际策略验收：它仍是平台级可用性检查，Workspace 绑定专属权限由后端落实。

本轮未引入 strict 读取白名单、read-only 工作区模式、Landlock/seccomp、域名代理、凭证代理或 Windows 后端。原生 HOME、临时目录和工具链仍与宿主共享，网络仍默认 allow，macOS mach-lookup 仍按原策略放行。上述能力需单独完成策略、生命周期及跨平台验证。

首阶段文件与网络边界优化已进入 public 提交 `1cc75bc44`。后续环境清理与启动就绪检查通过仓库 patch 构建脚本提升实际受影响包：`@downcity/sandbox-native` 为 `1.5.1`，`@downcity/city` 为 `1.5.16`；依赖包仅参与构建，不额外提升版本。提交不包含 push 或手动发布操作。

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

Linux Bubblewrap 修改已完成代码和参数级检查，尚未在 Linux 内核环境实跑。本机没有 bwrap，Docker daemon 也未运行，不能将 macOS 检查视作 Linux 验收。

## 后续范围

本轮未引入 strict 读取白名单、read-only 工作区模式、Landlock/seccomp、域名代理、凭证代理、环境变量 scrub 或 Windows 后端。原生 HOME、临时目录和工具链仍与宿主共享，网络仍默认 allow，macOS mach-lookup 仍按原策略放行。上述能力需单独完成策略、生命周期及跨平台验证。

本轮未修改版本号、提交或发布；准备发布时按仓库 patch 脚本规则确定实际受影响包。

# 原生 Sandbox SSH 身份使用

Provider 增加 `ssh: { socket_path, known_hosts_path }` 显式宿主授权。两者解析为现存真实绝对路径，分别验证 Unix socket 和普通文件；network=deny 时拒绝授权。路径不能包含换行、NUL、反斜线、双引号或 SSH 百分号扩展，以免 SSH 参数产生额外解释。授权纳入 policy digest。

每次 spawn 校验端点路径和类型；清理命令环境后，由 Provider 授权值设置 SSH_AUTH_SOCK。未授权时即使通用凭证名单放行 SSH_AUTH_SOCK 也仍移除。Git 默认命令使用 /usr/bin/ssh -F /dev/null，禁用私钥文件加载、交互密码、agent forwarding、主机密钥自动更新，严格校验宿主维护的专用 known_hosts。现存用户 SSH Include、ProxyCommand 和其他配置不会自动沿用。直接 ssh 不自动读取 GIT_SSH_COMMAND，调用方需要设置参数。

macOS 在受保护目录 deny 中排除两个精确端点，known_hosts 保持禁止写入。Linux 先遮蔽受保护内容，再精确 ro-bind 授权端点，最后将空目录重新只读。私钥兄弟文件继续隐藏。允许的两个端点不代表整个目录开放。

权限限制：socket 是签名能力，未限制到仓库、目的地或 SSH agent 协议消息；命令能够更改自己的 Git/SSH 参数，默认参数不属于强制安全规则。当前网络 allow 与共享宿主读模型并不保证拒绝所有其他可发现的 Unix socket。本轮只验证未授权环境变量不被注入，不能将其宣传为完整 IPC 白名单。端点重新校验也不保证防御检查后恶意并发替换。

CLI/Desktop 默认 Provider 尚未注入 SSH 配置，本轮提供 SDK 接口，未增加用户授权 UI。snapshot 新增可选 `allowed_read_paths`，context.sandbox.get 总是返回该数组；只报告专用 known_hosts 的精确读取例外。路径解释优先检查该精确例外，不放开兄弟文件、子路径或写权限。socket 是连接能力，不属于普通文件读取例外；现有 explain_path 不判断 socket 连接，不能将其 read 拒绝解释成无法使用 SSH agent。受控检查已验证读取例外及兄弟、子路径、写权限继续拒绝。

验证脚本 `scripts/native-ssh-canary.mjs` 创建临时密钥和独立 ssh-agent，不访问用户真实身份。macOS 和 Linux 均实测通过 agent 签名、私钥内容不可读、专用 known_hosts 可读不可写、未授权环境不带入 socket、Git 主机验证和 forwarding 默认值检查。Linux 加 --authentication 通过临时 loopback sshd 完成认证，再清空 known_hosts 验证未知主机失败；随后增加临时 source 和 bare 仓库，在沙箱内通过同一 loopback sshd 完成 git push，并核对远端 refs/heads/canary 的提交哈希与本地 HEAD 一致。没有连接公网或真实用户仓库。Linux 已使用 SHA256 校验的官方 Node 22.23.4 复验签名、只读信任文件、私钥内容隔离、完整认证、未知主机拒绝及 Git push，全部通过；临时 Node、密钥、仓库和服务已清理。type、native、city 构建与 30 项现有相关测试通过。

临时代理、服务与密钥在脚本结束时清理；项目新增接口尚未提交或发布。

# Workspace SSH 授权入口方案

## 目标

让用户为指定 Workspace 授权使用一个本机 SSH agent 身份服务，Agent 在 Sandbox 内完成 Git SSH 操作。私钥不进入项目或数据库；不默认继承所有机器身份。

## 所有权与存储

授权记录归本地 Workspace 配置所有，由 city/local 的 WorkspaceRepository 持久化到现有 config_json，无需新增数据库表。保存 socket 的真实绝对路径和授权时间，不保存私钥或 token。已信任主机保存到 Downcity 私有数据目录下每个 Workspace 独立的 known_hosts 文件。该文件不能置于 Agent 可写项目中。

首次授权由用户明确选择 socket；当前 SSH_AUTH_SOCK 只能作为宿主检测候选，不可由模型工具自行提交授权。重启后 socket 消失、真实路径变化或类型改变时，显示“需要重新授权”，不自动追踪到其他 socket。

## CLI 与 Desktop

CLI 提供 Workspace SSH 的 status、authorize、revoke，以及主机指纹查看与确认操作。显式 authorize/revoke 命令代表用户意图，批处理需明确参数。Desktop 在 Workspace 设置中提供状态、socket 选择、主机信任列表和撤销入口，通过 main IPC 调用相同宿主服务，不在 renderer 中读密钥或直接执行 SSH。

此处不会承诺只使用指定的一把密钥：socket 中可能存在多个身份，第一版授权整个 socket。界面应明确授权同一 Workspace 内所有 Agent 使用这些身份，不把 Chat Session 当作授权边界。

## 配置应用与撤销

现有 Shell 在 bind 时创建固定策略，只更新数据库不能更新运行中的身份。

第一版采用停用并重建 Workspace 运行实例：冻结新工作，停止该 Workspace 中的 Agent 执行和 Shell Sessions，释放旧实例，再提交并应用新配置。失败时保持未就绪状态，提示重试，不能报告撤销完成。配置服务与本机 daemon/Desktop runtime 必须协调，CLI 不能只改数据库便报告运行时生效。现有 City.workspaces.remove 可作为资源释放基础，但不得删除 Workspace 配置或项目文件。

该过程会中断当前 Workspace 的任务和命令，Desktop 需要确认提示；同一 Workspace 的其他 Agent 同样受影响。其他 Workspace 不重建。

进程已经获得签名、远程操作已完成的结果无法撤销。需要验证子进程树及 SDK 短命令清理，不能只终止父进程就宣称身份彻底撤销。首版若无法保证收口，操作必须显示失败并要求关闭该运行实例。

## 主机信任

从目标主机采集公钥后显示 host、port、key type 和 SHA256 指纹；只有用户依据独立来源核实并确认后才写入专用 known_hosts。ssh-keyscan 的输出本身不作为可信证据。未知主机和指纹改变都拒绝连接，不自动接受。只允许主机信任服务写该文件，Sandbox 内只读。

第一阶段可以先支持用户导入已独立核验的 known_hosts 条目，避免把网络探测、交互确认和凭证授权混在一个大操作中。

## 装配

CLI create_cli_workspace 与 Desktop create_desktop_workspace 读取同一 LocalWorkspaceConfig，由应用层转换成 NativeSandboxProvider.ssh。公共 city/local 配置不依赖具体 Native 后端类型；授权业务服务拥有路径校验、文件管理、审计与运行实例切换。Provider 保留最终端点类型校验和每次 spawn 的复核。

## 交付与验收

1. 保存现有 SSH 底层检查点及中英文文档。
2. 实现共享仓储与宿主授权服务，定义错误及运行切换结果。
3. 接入 CLI 命令、daemon 同步及 Desktop IPC/Workspace 设置。
4. 验证授权隔离、持久化、重启失效、撤销中断、失败不假成功，以及已信任主机下的本地 Git push。

已确认：第一版授权变更会中断该 Workspace 的运行任务，以换取明确的生效边界。现有 IPC/命令结构与状态返回沿用项目约定。

## 当前实现进度

共享配置层已落地，尚未接入 CLI/Desktop 操作入口：

- LocalWorkspaceConfig 增加 ssh 记录，WorkspaceRepository 支持持久化和清除，并严格解码；Workspace 改名保留授权。
- WorkspaceSshAuthorization 提供输入预检、授权记录写入、状态查询、装配前授权解析和记录撤销。它不持有运行实例，写入/撤销方法必须由应用层放在“已停止旧实例、并阻止并发创建”的切换流程内调用，不能将更新数据库当成运行时撤销成功。
- socket 的真实路径、设备号和 inode 一同保存，服务重启后重建同一路径也须重新授权。解析失败直接阻止授权恢复，不从宿主 SSH_AUTH_SOCK 自动回退。
- 导入用户核实的普通 known_hosts 记录，首版不支持 CA 标记。当前只校验记录格式，不证明密钥来源可信；主机指纹仍需独立核验。
- 信任文件放到宿主 root/security/workspace-ssh/<workspace_id> 的独立文件，目录 0700、文件 0600，拒绝项目内存储、符号链接别名和非宿主所有的目录。旧文件暂保留，待运行生命周期明确后再收集，避免删除仍被旧进程引用的资源。

验证：City 构建、类型检查通过；自有临时数据库/socket 的运行检查覆盖 disabled → ready、持久化恢复、改名保留、socket 消失后 needs_authorization、失效解析抛错和记录撤销。现有本地数据与 Workspace/Shell 检查 19 项中 18 项通过，Power 配置迁移测试因 TOML 返回 null-prototype 对象与普通对象 deepStrictEqual 不同而失败，该测试与脚本未被本轮修改。

已增加 City.workspaces.replace(workspace_id, create)：立即关闭该 Workspace 的进入、查询与 add 入口，等待同 ID 在途解析退出，串行停止旧实例和各 Agent 执行，随后调用宿主工厂重建。失败保留阻止状态，显式 replace 重试才能恢复；其他 Workspace 不受影响。关闭 City 会等待在途替换退出，防止 Storage 释放后工厂继续写入。共享授权服务的 change 方法复用 replace，仅在清理成功后保存授权/撤销记录，再由宿主工厂创建新实例。

CLI create_cli_workspace 与 Desktop create_desktop_workspace 已读取并复核持久化授权，再显式注入 Provider；未授权时不注入，端点失效直接报错而不使用默认身份。两者复用 resolve_workspace_ssh_access，不各自重复规则。

运行检查验证同 ID 并发串行、切换期间禁止进入和 add、其他 Workspace 可用、工厂失败后保持关闭及显式重试恢复。City 构建、CLI 类型检查和 Desktop main/renderer 类型检查通过；16 项现有本地数据与 Workspace/Shell 检查通过（不含已记录失败的 Power 迁移测试）。

Desktop 已接通 Workspace 设置的 SSH 身份分区、preload、状态 IPC 和变更 IPC。用户手动选择 socket 路径并导入已独立核验的 known_hosts 记录；没有自动扫描主机或默认采用进程 socket。变更由主进程再次弹出原生确认框，明确中断任务、Workspace 全体 Agent 共享身份和非仓库级授权。状态仅在 change 成功后更新；失败展示错误，不乐观报告撤销完成。控制器在旧实例清理后丢弃该 Workspace 的 Session 投影缓存，避免新实例引用旧运行状态。

SSH 管理 IPC 检查调用者为 Desktop BrowserWindow 的 mainFrame，页面 URL 的 origin、pathname 和 search 必须与实际加载的 Renderer URL 一致；不接受其他 file 页面、任意 localhost 页面或 iframe。授权字段先做类型和体积校验，最终路径规则由共享服务检查。该检查不抵御已控制可信 Renderer 的攻击，但原生确认不能由 Renderer 直接跳过。

City 构建及 Desktop main/renderer 类型检查通过；16 项现有本地数据和 Shell 测试通过。临时 City、数据库与 socket 验证授权变更后持久化，新实例工厂失败仍报错且保持运行门禁关闭，显式重试后恢复。尚未启动 Electron 做真实点击端到端验收；原生确认框目前为英文，界面主体提供中英文。

尚未增加 daemon 管理路由或 CLI 命令。Workspace replace 是本进程的资源门禁，不是跨进程分布式锁；现有 CityHostRegistry 具有单宿主声明协议，CLI 写操作应通过当前宿主管理能力或在持有独占宿主所有权后操作，不能绕过运行切换直接写数据库。已持有旧引用的操作以及子进程树、SDK 短命令的彻底回收需继续验证；在这些验收完成前不宣称已实现完整撤销保证。

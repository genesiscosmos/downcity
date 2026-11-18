# FrontierHarness 本地接入方案与实施状态

> 更新日期：2026-11-18。状态：本地真实 smoke 已完成，最终原始 verifier reward 1.0，pytest 1 passed，SDK 执行成功。有效模型运行使用 Krill GPT-6.1 Sol，5 次模型请求、4 次终端调用，完整耗时 272.022 秒。
> 工具与最新命令：[evals/frontierharness/README.md](../evals/frontierharness/README.md)。目标是单题 SDK + 终端工具 smoke，不代表完整 City/Desktop。
> [完整本地运行报告与证据](../evals/frontierharness/artifacts/smoke-20261118T024622Z/local-run-report.md)。已授权调整 Colima 并运行题目容器、模型与 verifier；没有重启或部署 City/localnode。Teable 三个容器和 searxng 已恢复，但原 `downcity-pg-migration-check` 及匿名卷重启后未列出、恢复未完成，详见报告。另保留 CLI 权限失败及 0 模型请求的元数据失败 trial，不能描述为全程一次无失败启动。

## 1. 建议与评测范围

建议首轮使用 **Harbor 0.22.0 原生 Docker + 外部 Downcity Agent SDK + 容器终端适配器**，只运行 `terminal-bench@2.0` 的 `regex-log`，并发 1、一次尝试、自动重试 0。

这是 **Downcity SDK 的受限终端配置 smoke test**：保留 Agent、Session、Composer、Executor、模型协议和工具循环，终端工具经 Harbor 进入任务容器。它能证明基本接入可行，不能代表完整 City/Desktop、现有 Shell 的持久交互行为、文件 Power、Memory、Skill 或多 Agent 协作能力。结果应记录 `methodology_comparable: false`，不进入公开榜单比较。

用户已确认此最小范围并授权实施。完整 Downcity 产品及现有文件/Shell 工具需要另行设计 Harbor Workspace Adapter，不能沿用此 smoke 的结论。

## 2. 仓库与现有接口证据

本地实际结构是 `public/packages/{agent,city,cli,federation,type}`，Sandbox 实现在 `public/packages/implementations/sandboxes/{native,microsandbox}`，远程 Workspace 有 SSH 与 Cloudflare Computer。根目录与 public 均已有其他未提交修改，不能视为干净版本。

本次观察到 public HEAD：`dfdf54d171bf1873eb350d1cbbc417ff58220a3d`。本地 manifest 的版本为 Agent `1.5.27`、City `1.5.26`、CLI `1.6.6`、Federation `1.6.6`；这不证明现有 bin 与源码一致，也不代表 npm 已发布状态。

| 能力 | 已验证结论 | 源码证据（行号按本次工作树） |
| --- | --- | --- |
| 非交互 CLI 提交 | 支持 `city session create/send/history/stop`，输入支持 `--message-file`、stdin、`--request-id`、`--json` | `packages/cli/src/city/command/ResourceCommands.ts:37`；`resources/ResourceOutput.ts:20` |
| Agent/模型指定 | `agent create/update --model`；session 地址显式带 Agent/category；当前 `session send` 命令未提供单次 `--model` | `packages/cli/src/city/command/ResourceCommands.ts:7`、`:13`、`:49` |
| 工作目录 | `workspace register <path>`，Session 使用 `--workspace` 或 `--workspace-path`；也有 SSH 注册入口 | 同文件 `:22`、`:39`、`:49` |
| CLI 执行前提 | 会话执行要求已有 City 宿主，CLI 不自动启动宿主；没有宿主时返回 `host_offline` | `packages/cli/src/city/resources/ResourceClient.ts:1`、`:66` |
| CLI timeout | `--timeout` 同时约束管理请求和等待；断开等待不发送 Session stop，不能充当任务硬时限 | `resources/ResourceOutput.ts:38`、`:58`；`resources/ResourceClient.ts:15` |
| SDK 提交/停止 | `new Agent({ model, tools, ... })`；`sessions.create()`、`session.prompt()`、`handle.finished`、`session.stop()` | `packages/agent/src/types/agent/AgentOptions.ts:33`；`SessionActor.ts:55`、`:105`；`types/sdk/AgentSessionTurn.ts:38` |
| SDK 轨迹 | `session.subscribe()` 观察 mutation，`session.messages()` 分页读取 canonical 消息；最终 turn 返回 text/success/error，不直接返回完整 usage | `packages/agent/src/types/agent/SessionActor.ts:113`；`types/sdk/AgentSessionTurn.ts:13` |
| 轮次边界 | Executor 当前固定 `MAX_TOOL_LOOP_STEPS = 1000`；所查公开 Agent/Session/CLI 参数未见可配置 `max_turns` | `packages/agent/src/session/runner/ToolLoopLimits.ts:16`；上述公开参数类型 |
| 模型 usage | ModelClient 单步流会提供 `model_usage`；有输入、输出、cache read/write、reasoning 字段，可在评测宿主包装客户端采集 | `packages/type/src/types/model/ModelClient.ts:12`；`ModelStreamEvent.ts:46`；`ModelUsage.ts:8` |
| 工具注入 | 自定义 AgentTool 支持 schema + execute；Agent 无 Workspace 时仍可使用自有 tools，工具合并不隐式附加 City Power | `packages/type/src/types/tool/AgentTool.ts:17`；`packages/agent/src/agent/Agent.ts:215`、`:539` |

表中相对路径均以 `public/` 为根。CLI 已具备自动化接口，但它依赖已有宿主和当前 Workspace 装配，直接发送任务不能自动获得 Harbor 容器隔离。本方案采用 SDK，避免为一次 smoke 新增 City 守护服务和全局注册状态。

## 3. shell 与 files 的真实执行边界

- CLI 的 `create_sandbox_provider()` 固定创建 `NativeSandboxProvider`，没有现成的 Harbor/Docker 选择参数：`packages/cli/src/city/sandbox/PlatformSandbox.ts:14`。
- `Shell.bind()` 让 Provider 创建 Workspace sandbox，默认命令通过其 `spawn()`；因此工具落在哪里取决于具体 provider，不取决于评测任务名称：`packages/city/src/shell/Shell.ts:96`、`:125`。
- 本地 `Workspace` 显式使用 Node `LocalFileSystem`，注释也说明文件工具在宿主进程运行；挂载信息只负责路径映射，不会把本地读写变成 Docker 内远程读写：`packages/city/src/workspace/Workspace.ts:81`；`LocalFileSystem.ts:24`。
- Sandbox 的进程协议还包含 PTY、stdin、kill、进程事件与持久 Session；Harbor `environment.exec()` 是短命令接口，不能直接冒充完整 `ShellProcessHandle`：`packages/type/src/types/shell/Sandbox.ts:142`。
- 如果从外部运行 Downcity，要支持完整产品工具，必须把 shell **和** files/search 都适配到任务环境。仅写 Docker shell provider 或把任务目录同步到宿主不足以保证环境一致性。

首轮仅提供一个自定义 `terminal_exec` 工具：所有读写文件、grep、运行程序都在 `environment.exec(command, cwd, timeout_sec)` 中完成。不给 SDK 注入本地 Workspace、宿主文件工具或 host shell。工具默认 cwd 来自任务配置（本题 `/app`），模型不能选择宿主执行目标。任务容器不挂载 Docker socket、Downcity 数据根或本机仓库。

这也解决了任务容器无法访问模型端点的问题：SDK 的模型调用在宿主，任务命令留在隔离环境。模型客户端由宿主持有，密钥不传入任务容器。

## 4. 本机只读检查

下表为 2026-11-17 的初始只读环境快照；2026-11-18 实际运行版本、资源与清理结果以顶部链接的运行报告为准。

| 项目 | 观察结果 |
| --- | --- |
| Docker CLI | 28.5.1 |
| Docker daemon | 已可连接，Engine 28.4.0，Linux ARM64，context 为 `colima` |
| Docker Compose | 2.40.3 |
| Docker VM 资源 | 2 CPU，2,055,757,824 bytes（约 1.91 GiB） |
| uv | 0.11.3 |
| Python | 默认 `/usr/bin/python3` 为 3.9.6；另有 Homebrew 3.13.16、3.14.3，uv 目录有 3.11/3.13 |
| Harbor Python 要求 | 固定版本 0.22.0 的 `requires-python >=3.12`；应显式选择现有 3.13，不能使用默认 Python |
| Node / pnpm | Node v26.11.1 / pnpm 10.22.0 |
| Git / jq | Git 2.50.1 / jq 1.7.1 |
| Harbor / Pier | PATH 未发现；uv tools 未见；Homebrew Python 3.13 包元数据未见二者。这不是对所有虚拟环境的全盘断言 |
| 本地 checkout | 常用目录 `/Users/wangenius/Documents/github` 及直接子目录、Documents/Home 顶层、当前仓库顶层未发现命名相关 checkout；`Documents/deepseek-harness` 仅见 `default-workspace`，不是 Git checkout |
| city / downcity | PATH 存在；未执行 CLI，未验证现有 bin 与源码对应关系 |

**资源实测：** 已在授权下将原 Colima profile 调为 4 CPU / 8 GiB，保留 100 GiB 磁盘。单题仍按原始 1 CPU / 2,048 MiB 配置执行，下载后的 task.toml 与 Dockerfile 哈希匹配固定来源。重启前还必须核对 AutoRemove、匿名卷和恢复条件，不能仅凭 restart policy 判断可恢复。

调整 Colima 涉及重启和现有容器中断，本次已单独获批。重新核对 manifest 并实际拉取 linux/amd64 镜像，digest 为 `sha256:90101b2e815323a8da20528a1439bebc407eb9761c9c68a3d557730856c878e9`；通过现有 QEMU 实测 Bash/coreutils 与 `/app` 默认目录，最终完成原始 verifier。

## 5. Harbor 契约与单题执行计划

已阅读 Harbor `v0.22.0` 源码，而非只使用最新 README 猜测接口：

- `harbor.agents.base.BaseAgent`：实现 `name()`、`version()`、`setup(environment)`、`run(instruction, environment, context)`。
- `harbor.environments.base.BaseEnvironment`：有 `exec(command, cwd, env, timeout_sec, user)` 与文件 upload/download。由 Harbor 持有环境生命周期。
- `harbor.models.agent.context.AgentContext`：填入 `n_input_tokens`（含缓存）、`n_cache_tokens`、`n_output_tokens`、可选 `cost_usd` 和 `metadata`。不应自行发明 AgentResult 返回结构；`run()` 返回 None 并更新 context。
- CLI `-a module.path:ClassName` 可加载自定义 Agent；`--ak key=value` 传 adapter 参数。无需修改 Harbor 内置 registry。`--agent-import-path` 在该 tag 中是旧别名。
- CLI 的 `-n` 表示并发、`-k` 表示每题尝试数、`-r` 表示基础设施重试。Docker 为默认环境，也可显式 `--env docker`。任务筛选使用 `-i`。

本次已按以下流程执行；后续重复运行仍需确认当时的环境与执行授权：

1. 固定 Downcity 源码快照、FrontierHarness commit、Harbor 0.22.0 和 Node/Python 版本。若评测当前未提交源码，记录基准 SHA、相关差异哈希和实际构建产物哈希，不把它写成纯 HEAD 结果。
2. 在独立评测目录建立 Python 3.13 虚拟环境并安装 Harbor 0.22.0；准备本地 SDK 构建产物和 Node runner。只复制/构建必需包，不全局安装 FrontierHarness skill，不装 Runta/Pier。
3. 检查 regex-log registry 任务和镜像，确认只匹配一道任务；保留原始 instruction、verifier、timeout、资源与网络规则。FrontierHarness 的 `tasks/regex-log/task.toml` 是核对资料，不能假设其 schema 可直接作为 Harbor 本地任务加载。
4. Harbor 创建一份任务 Docker 环境。Python `BaseAgent` adapter 启动一次性 Node 子进程，stdin/stdout 使用带 id 的 JSONL 协议，stderr 仅输出运行诊断。无需监听端口或启动 City 服务。
5. Node 使用 `Agent({model, tools:{terminal_exec}})` 创建全新 Session；Python 接收工具请求，调用当前 `environment.exec()` 后回传 stdout/stderr/exit code。bridge 必须处理多请求 id、输出截断、单命令超时与取消，不能执行模型发来的宿主命令。
6. 包装 ModelClient 采集每个实际模型请求的 usage，并可按用户预算限制请求数。采集包括压缩/恢复等通过该客户端发起的调用；同一次调用的累计 usage 不能重复求和。未返回的指标保留 unknown。
7. 完成或超时后导出原生轨迹、usage、最终文本和错误，Harbor 运行原始 verifier。适配器取消时主动 stop Session、终止 Node 及未完成命令，等待 Harbor 清理环境；CLI 退出码不代替 verifier 成绩。

单题命令模板（模型配置、上下文窗口与授权要求见工具 README；真实运行参数另存 artifact）：

```bash
cd public/evals/frontierharness
PYTHONPATH="$PWD" .venv/bin/harbor run --registry-path ./registry.json \
  -d terminal-bench@2.0 -i regex-log \
  --env docker -a downcity_agent:DowncityAgent -m "$MODEL_ID" \
  -n 1 -k 1 -r 0 --delete --ak run_timeout_sec=900 \
  --ak max_model_calls=16 --ak max_tool_calls=32 --ak max_output_tokens=4096 \
  --jobs-dir ./artifacts/regex-log
```

不要使用 `terminal-bench/terminal-bench@4.0.0`，官方说明它是另一个 66 题语料，无法匹配本基准任务。Runta 专用 CA compose overlay 不应复制到本地 Docker 命令中。

已将 Harbor v0.22.0 registry 的单题条目保存为工具的 `registry.json`，固定任务 commit `69671fbaac6d67a7ef0dfec016cc38a64ef7a77c`。实际原始任务为 Agent 900s、verifier 900s、build 600s、1 CPU、2,048 MiB RAM、10,240 MiB storage，Dockerfile workdir `/app`；Harbor 0.22.0 解析的网络模式为 public，原始 verifier 会联网安装依赖。适配器默认时限为 900s，不覆盖原始任务配置，也不是整个 job 的总时长上限。

FrontierHarness 参考 commit `e837a70bd6beb4e72eeeda62dd06e3bd34f6cb63` 的同题元数据为 Agent 1,200s、`allow_internet=false`，与所选原始任务不同。本工具不能声称复现其全套运行条件。任务来源、内容哈希和镜像观察保存在 `sources.json`。

## 6. 实施文件与产物

已在 `public/evals/frontierharness/` 实现独立评测工具，不进入核心运行时：

| 已实现文件 | 职责 |
| --- | --- |
| `downcity_agent.py` | Harbor BaseAgent、任务环境 exec 桥接、子进程生命周期、AgentContext 回填 |
| `downcity_runner.ts` | Agent SDK 装配、终端工具、JSONL 协议、usage 与请求数统计、轨迹导出；构建为一次性 Node 入口 |
| `pyproject.toml`、`uv.lock` | Python 3.13 与 Harbor 0.22.0 固定依赖，目录内 `.venv` 已安装 |
| `package.json` | 评测入口及必需本地 SDK 依赖，具体构建方式复用仓库工具链 |
| `README.md` | 本地运行条件、配置键名、评测范围和证据查看方法 |
| `.gitignore` | 排除虚拟环境、artifacts、生成包及本地凭据文件 |

辅助文件包括 `container_command.sh`（容器 Bash/coreutils 输出限制与进程组清理）、`types/bridge.ts`（JSONL 契约）、`build.mjs` / `tsconfig.json`（本地公开 SDK 构建）、`registry.json` / `sources.json`（单题固定来源）。核心 `agent/city/cli` 未修改，没有新增测试用例，不触发 package bump 或 homepage 功能文档更新。

已完成 Node 26.11.1 / Python 3.13.16 下的共享类型、Agent、Federation 无 bump 构建，以及适配器 TypeScript 类型检查/构建、Python 编译、Harbor 0.22.0 公共工厂 import/参数验证、registry 单题解析、CLI help 和 Bash 语法检查。真实运行已覆盖 SDK prompt、5 次模型请求、4 次容器终端调用、原始 verifier 和正常收口；故意取消/超时路径尚未实测。

真实运行产物位于 `evals/frontierharness/artifacts/smoke-20261118T024622Z/`，包括：

- `downcity-build-info.json`：HEAD、工作树/差异哈希、SDK 源码与构建哈希、两级 lock、任务来源，不能把未提交工作树描述为纯 HEAD。
- Harbor 原始 job/trial result、verifier reward/log、基础设施错误及时间记录。
- `downcity-trajectory.jsonl`、完整 canonical 分页 `downcity-messages.jsonl`、`downcity-checkpoint.json`、最终文本与 usage 的 `downcity-result.json`、最终 `downcity-context.json`、有界 `downcity-stderr.log`。中断时部分最终产物可能不存在。
- 同一调用累计 usage 只覆盖、不重复求和；缺失或中断未收口指标为 null，`cost_usd` 保持 null。请求数、字节额度与 Provider 输出参数均不构成绝对金额上限。

首轮保留原生轨迹即可，不宣称已支持 Harbor ATIF；未来转换时再设置 `SUPPORTS_ATIF`。FrontierHarness trial.json/normalizer 接入可在 smoke 成功后新增；需保留 cache read/write 和第一请求 usage 才能计算官方 first-cold 成本。不得将首次模型请求与一次用户 turn 混为一谈。

## 7. DeepSWE / Pier 后续差异

| 项目 | 首轮 Terminal-Bench smoke | DeepSWE 扩展 |
| --- | --- | --- |
| 执行器 | Harbor 0.22.0、Docker | `datacurve-pier==0.3.1`，不能默认沿用 Harbor 全部参数/API |
| 任务来源 | `terminal-bench@2.0`，`regex-log` | deep-swe corpus commit `435ee89ec2f2e2289f33b0da4f992f0b7b7266b9`；`v1.1` 不是 Git tag |
| 任务命令 | `harbor run -d ... -i ...` | 官方模板 `pier run -p /work/deep-swe/tasks/{task} --agent ... --model ... --jobs-dir ...` |
| 网络 | SDK 模型在宿主；容器按任务规则隔离 | 官方采用 Pier 的 per-agent allowlist 解决禁网任务里的模型访问；需要核对外部 SDK 拓扑与其网络规则是否匹配 |
| 额外工作 | 两个 adapter 入口与本地依赖 | 语料、镜像/构建和 verifier 依赖、Pier 自定义 Agent 契约、额外资源和网络预检 |

首轮不需要安装 Pier、下载 deep-swe、使用 Runta checkpoint 或运行官方全量脚本。即使后续也采用外部 SDK，Pier 的任务格式、结果和注册入口仍需独立核查，不能推断 Harbor adapter 原样可用。

官方模型固定 **Kimi K3**；换 provider 也需 matched control 才能讨论可比性。现有其他模型可用于验证接入，但只能报告本地 smoke。即便使用 Kimi K3，本地 ARM64/仿真、外部 SDK 工具配置、网络政策、资源与冷启动条件均与公开基线不同，仍不能据此宣称榜单分数或成本优劣。

## 8. 模型配置与后续执行边界

本次单题、镜像拉取、模型调用、Colima 8 GiB / 4 CPU 调整及现有容器中断恢复均已获明确批准。恢复结果见运行报告，不能将 4 个容器已运行写为原 5 个全部恢复。

当前节点 `http://127.0.0.1:12314` 的标准 `local` 登录/exchange 已实测可签发普通 user_token；新 token 仅在进程内存及专用子进程环境传递，未读取现有 key、token、.env 或上游凭据。匿名模型目录返回 401，认证后返回 200。兼容 base URL 是 `http://127.0.0.1:12314/v1/ai`。该目录将 Krill GPT-6.1 Sol 登记为 `gpt-6.1-sol`，description/tags 明确为 Krill；这也是实际请求 ID。

适配器必填专用变量为 `DOWNCITY_EVAL_API_KEY`、`DOWNCITY_EVAL_BASE_URL`、`DOWNCITY_EVAL_CONTEXT_WINDOW`，本轮窗口由目录核实为 `1000000`，经正安全整数校验后传给 ModelClient，供 SDK 请求预算使用。请求与输出限制不代表金额硬上限。

后续评测需重新核对在线节点、模型目录、认证、可中断容器及执行授权；本次批准不延伸为部署/重启 localnode、City 或其它服务的权限。

## 9. 官方证据

- [FrontierHarness skill：固定版本、deep-swe pin、运行前提](https://github.com/frontier-harness-eval/eval/blob/main/skills/frontierharness-eval/SKILL.md)
- [FrontierHarness reference：registry、筛选参数、Runta/Pier、模型与成本](https://github.com/frontier-harness-eval/eval/blob/main/skills/frontierharness-eval/reference.md)
- [regex-log 元数据](https://github.com/frontier-harness-eval/eval/blob/main/tasks/regex-log/task.toml)
- [Harbor 0.22.0 Python 要求](https://github.com/laude-institute/harbor/blob/v0.22.0/pyproject.toml#L9)
- [Harbor BaseAgent](https://github.com/laude-institute/harbor/blob/v0.22.0/src/harbor/agents/base.py)
- [Harbor 环境接口](https://github.com/laude-institute/harbor/blob/v0.22.0/src/harbor/environments/base.py#L1128)
- [Harbor AgentContext](https://github.com/laude-institute/harbor/blob/v0.22.0/src/harbor/models/agent/context.py)
- [Harbor CLI：jobs/start](https://github.com/laude-institute/harbor/blob/v0.22.0/src/harbor/cli/jobs.py#L543)
- [Harbor 自定义 Agent 加载](https://github.com/laude-institute/harbor/blob/v0.22.0/src/harbor/agents/factory.py#L157)

远程 main 内容可能继续变化；本次实施已记录固定任务 commit、FrontierHarness 参考 commit、配置内容哈希与远程镜像 manifest，详见工具 `sources.json`。GitHub tree API 调研时遇到匿名限流，随后通过固定版本原始文件与本地 Harbor 0.22.0 安装包核对接口，没有克隆任务仓库或安装第三方 skill。

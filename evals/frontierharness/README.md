# Downcity SDK 本地评测适配器

本目录提供独立的 **Harbor 0.22.0 / Pier 0.3.1 + 原生 Docker + 外部 Downcity Agent SDK** 单题配置。支持 `terminal-bench@2.0/regex-log` 与 `deep-swe@v1.1/anko-typed-variable-bindings`，每次只运行选定的一题，并发 1、尝试 1、job 重试 0。它验证 SDK、模型工具循环、容器终端和原始 verifier 的接入，不代表完整 City/Desktop，结果固定记录 `methodology_comparable: false`，不能与官方榜单直接比较。

当前状态：2026-11-18 已完成本地真实 smoke，最终原始 verifier reward **1.0**、pytest **1 passed**。有效模型运行共 5 次请求、4 次终端调用，Agent 40.886 秒、完整运行 272.022 秒。另保留 CLI 缓存权限失败和 0 模型请求的上下文元数据失败 trial；不能把过程描述为无失败的一次启动。完整证据见 [本地运行报告](artifacts/smoke-20261118T024622Z/local-run-report.md)。后续运行、Colima 资源调整与重启仍需按实际环境获得授权。

DeepSWE 当前状态：2026-11-18 已完成固定镜像拉取、禁网预检和 **Anko 单次 Krill 模型运行**。模型自行提交 `f9c2742`，原 collect 成功。原 CLI 在 verifier Compose build 阶段发生 buildx/沙箱权限异常，保留该失败 trial；随后仅对同一 patch 续接原始判题，结果 **reward=0，partial=0.2621359223300971，F2P 0/9、P2P 27/94**。VM 测试包构建失败，大量测试没有实际运行，完整编译诊断未被原脚本保留，不能将全部失败直接归因于模型实现。模型 18 次请求、17 次终端调用，Agent 472.977 秒；没有再次调用模型或重跑有效评分。详见 [本轮完整报告](artifacts/anko-execution-20261118T081707Z/local-run-report.md)。Colima 保持 4 CPU / 12 GiB，最终根盘余量约 7.08 GiB，原 5 个容器/现存卷状态均保留；本题容器全部销毁，100 GiB 数据盘故障未处理。

2026-11-19 清理状态：Colima 已停止；本目录的两套 Python 虚拟环境、uv 缓存、下载语料及压缩包、临时下载源码和本地构建产物已删除。适配源码、依赖锁与运行证据保留。再次使用前需按下文重新准备依赖及语料。评测 Docker 镜像尚保留在已停止的 Colima 中，未为清理镜像重新启动服务。

## 执行边界

Harbor/Pier 持有任务环境及 verifier 生命周期。Python `DowncityAgent` / `DowncityPierAgent` 组合 `EvalRuntime`，启动一次性 Node 进程；Node 使用公开 `Agent`、`ModelClient`、`sessions.create()`、`session.prompt()`、`stop()`、`messages()` 和 `dispose()`。stdio 使用带请求 id 的有界 JSONL，没有监听端口或服务。

Agent 只注册 `terminal_exec`，不绑定 Workspace、City、文件 Power 或宿主 Shell。所有任务文件读取、搜索、写入和运行程序都经 Python 的 `environment.exec()` 进入当前容器。宿主仅运行 SDK、模型连接和证据导出。模型凭据不会通过 `environment.exec(env=...)` 传入容器。

命令包装层依赖任务容器已有 `/bin/bash` 与 GNU coreutils（`head`、`cat`、`timeout`、`base64`、`wc`、`mkfifo` 等）。`setup()` 只检查能力并创建独立 `/tmp/downcity-eval-*` 目录，不联网安装依赖。命令以 harness 设定的用户执行。Pier 公开 `install_spec()` 返回 None，`network_allowlist()` 返回空 `NetworkAllowlist`；模型网络不进入任务环境。

## 固定任务来源

`registry.json` 是 [Harbor v0.22.0 registry](https://github.com/laude-institute/harbor/blob/v0.22.0/registry.json) 的单题子集，明确固定原始任务仓库 commit `69671fbaac6d67a7ef0dfec016cc38a64ef7a77c`，只匹配一道 `regex-log`，不修改 instruction、task.toml 或 verifier。`sources.json` 保存核对来源、哈希及镜像观察结果。运行使用 `--registry-path`，避免默认远程 registry 变动。

该固定任务的实际配置是：Agent 900 秒、verifier 900 秒、build 600 秒、1 CPU、2,048 MiB RAM、10,240 MiB storage；Dockerfile 的 workdir 为 `/app`。Harbor 0.22.0 解析其网络策略为 `public`，原始 verifier 会联网安装 curl、uv 与 Python 测试依赖。因此这份配置不能描述为离线评测。适配器默认 Agent 时限也为 900 秒，Harbor 的阶段时限始终独立生效，清理另需短暂时间；这不是整个 job 的总时长上限。

FrontierHarness 参考 commit 为 `e837a70bd6beb4e72eeeda62dd06e3bd34f6cb63`，其中同题元数据写有 Agent 1,200 秒与 `allow_internet=false`。这份工具使用上面固定的原始 Terminal-Bench 任务配置，不能声称复现 FrontierHarness 全套运行条件。

2026-11-17 只读 `docker manifest inspect --verbose` 观察到镜像 `alexgshaw/regex-log:20251031` 为 **linux/amd64**，manifest digest 为 `sha256:90101b2e815323a8da20528a1439bebc407eb9761c9c68a3d557730856c878e9`。未拉取镜像层、未运行容器；tag 可变，首次运行前应重新核对。2026-11-18 已在授权下将既有 Colima 调为 Linux ARM64、4 CPU / 8 GiB，保留 100 GiB 磁盘，并通过已有 QEMU 实测运行该 amd64 镜像。此次重启后 Teable 三个容器与 searxng 恢复，但 `downcity-pg-migration-check` 及原匿名卷未列出，恢复未完成，详见 [异常记录](artifacts/smoke-20261118T024622Z/container-restoration-incident.md)。后续重启前必须检查 `AutoRemove`、匿名卷及恢复条件；工具不会自行更改 VM 配置。

### DeepSWE / Anko

`sources.json` 按 suite 保存独立来源。DeepSWE 固定 corpus commit `435ee89ec2f2e2289f33b0da4f992f0b7b7266b9` 的 `tasks/anko-typed-variable-bindings`；`v1.1` 是数据集标签。构建会核验已准备任务全部 10 个原始文件的 SHA-256，保留 instruction、task.toml、solution 和 tests 原文。Agent 只收到 Pier 提供的指令和当前环境终端，不提供宿主语料目录与测试文件工具。

原始 Agent 时限 5,400 秒；独立 verifier 时限 1,800 秒、build 1,800 秒。Agent 与 verifier 各声明 2 CPU、8,192 MiB RAM、20,480 MiB storage，网络均为 `no-network`。Pier Docker 0.3.1 生成 CPU/内存硬限制，但不设置 storage quota、预分配或最低空间准入；storage 是任务声明，真实可用磁盘取决于共享文件系统。Pier 先 collect 并关闭 Agent 环境，再创建 separate verifier；VM 仍需为 Docker、构建和既有服务留出额外内存。本轮 VM 为 12 GiB，正式 Agent 资源采样均为宿主 normal，后续出现 warning；采样最低根盘余量约 6.83 GiB，未触发 3 GiB 保留线。后续仍须逐阶段核对 DockerRootDir/containerd 所在文件系统和宿主压力；profile 数值、manifest 压缩量及单一 warning 指标均不能替代实测。

任务镜像为 `public.ecr.aws/d3j8x8q7/swe-bench-202605:kh79betfed7ets4an20cr4j57182y9wt-v1.1`。本轮已按 `sources.json` 的固定 digest 拉取并核实 linux/amd64；28 个 gzip 层合计 785,931,047 bytes，实际根盘占用增量约 3.50 GiB。Bash/coreutils、Go 1.25.5、goyacc、CTRF reporter、模块离线校验与禁网编译预检通过；正式 Agent/race 构建和 verifier 中出现编译异常，不能宣称仿真工具链全面稳定。

**模型必须遵守原 instruction 新建分支并提交。** collect 原文只执行 `git diff --binary 3f269a72ff69398b1250c584171f32d12c0d8085 HEAD`；未提交工作树不进入 model.patch，适配器不替模型自动提交。原始二元 reward=1 要求 fail-to-pass 全通过且无 pass-to-pass 回归；保留 partial、各组计数、CTRF 和原始日志。`reward=-1` 表示 verifier 异常，须报告基础设施问题，不能当普通答错。

## 准备依赖与构建

需要 Node >=22.13、Python 3.13、uv、仓库根目录的 pnpm 依赖，以及已获准使用的 Docker/Compose。不要在 `public/` 或本目录另装一套 pnpm Workspace 依赖。

从 Downcity 仓库根目录执行，仅构建、不 bump、不全局安装：

```bash
# 首次缺少仓库依赖时，在仓库根目录按项目规范执行 pnpm install。
pnpm -C public patch:build -- --no-bump --type --agent --downtown --no-global-install
node public/evals/frontierharness/build.mjs

cd public/evals/frontierharness
uv sync --frozen --python /opt/homebrew/bin/python3.13 --cache-dir ./artifacts/uv-cache
```

Python 路径应按机器上已有的 3.13 解释器调整。根 `uv.lock` 固定 Harbor 0.22.0 及传递依赖，安装到本目录 `.venv`。Pier 使用独立 `pier/uv.lock`，同时固定 `datacurve-pier==0.3.1` 与 `harbor==0.22.0`：

```bash
uv sync --project ./pier --frozen --python /opt/homebrew/bin/python3.13 --cache-dir ./artifacts/uv-cache
```

准备固定 DeepSWE 语料，仅下载源码，不拉镜像或运行任务。从本目录执行：

```bash
mkdir -p artifacts/deep-swe-435ee89ec2f2e2289f33b0da4f992f0b7b7266b9
curl --fail --location --silent --show-error \
  https://codeload.github.com/datacurve-ai/deep-swe/tar.gz/435ee89ec2f2e2289f33b0da4f992f0b7b7266b9 \
  --output artifacts/deep-swe-435ee89.tar.gz
printf '%s\n' '34c6fabd3dad1770d753829378a81c3d8bb658ff255de9f01f3606e213cd2b46  artifacts/deep-swe-435ee89.tar.gz' | shasum -a 256 -c -
tar -xzf artifacts/deep-swe-435ee89.tar.gz \
  -C artifacts/deep-swe-435ee89ec2f2e2289f33b0da4f992f0b7b7266b9 \
  --strip-components=1 \
  deep-swe-435ee89ec2f2e2289f33b0da4f992f0b7b7266b9/tasks/anko-typed-variable-bindings
node build.mjs
```

源码 archive 校验成功后再解包；构建逐文件核验并在 `task_source_checks` 中保存结果。构建脚本只链接当前 checkout 已有的 SDK 与 TypeScript 依赖，不联网装包。可以在本目录使用 `npm run build` 或 `npm run typecheck`，二者均调用该脚本。

`dist/build-info.json` 记录构建时 Node 版本、public HEAD、工作树状态、相关 tracked diff 哈希、两级 lock 哈希、SDK 源码/构建目录哈希及 adapter 源码/runner 哈希。工具使用当前工作树，存在未提交改动时不能把结果描述为纯 HEAD；每次正式运行前重新构建，并在运行期间保持源码和构建产物不变。

Harbor 默认使用 `~/.cache/harbor` 任务下载缓存；沙箱禁止写入该位置时，应为 Harbor 子进程配置本轮 artifacts 下的独立 HOME，并通过 `DOCKER_CONFIG` 指向原 Docker 配置目录、`DOCKER_CONTEXT=colima` 解析现有 Docker context。本轮新 token 只通过子进程环境传递，不写入独立 HOME。Docker 镜像/容器存储仍由已选 context 管理。

## 模型配置

只读取专用环境键，不读取 City、Desktop、Shell 配置或已有凭据文件，也不会自动加载 `.env`：

| 键名 | 用途 |
| --- | --- |
| `DOWNCITY_EVAL_API_KEY` | 模型端点鉴权；通过安全环境配置提供，不放命令参数或 Git |
| `DOWNCITY_EVAL_BASE_URL` | OpenAI-compatible API 根地址，需支持流式 `/chat/completions` 与 `stream_options.include_usage` |
| `DOWNCITY_EVAL_CONTEXT_WINDOW` | 必填；从模型服务目录核实的总上下文 token 数，正整数，供 SDK 请求预算使用 |
| `MODEL_ID` | 下方命令模板使用的 shell 变量；值原样作为端点的模型名称传入 `-m` |

目前只接入 SDK 已公开的 `create_openai_compatible_model()`，不提供 Anthropic 或 OpenAI Responses 协议转换。base URL 必须为 HTTP(S)，禁止 URL 用户信息、query、fragment 和 HTTP redirect。模型参数中的 provider 前缀不会自动剥离。

localnode Downtown 的兼容端点使用 `http://127.0.0.1:<实际端口>/v1/ai` 作为 base URL。HTTP 模型接口需要普通用户 token；可信本机客户端可通过公开 `Downtown.user.account.login_start({ provider: "local", client_type: "cli" })` 与 `exchange()` 获取本轮新 token，将返回的 `user_token` 仅通过进程环境传入 `DOWNCITY_EVAL_API_KEY`。不要读取已有凭据、使用占位 key 或把 token 打印到终端。模型目录使用同一 token 读取 `GET /v1/ai/models`，确认具体 ID、通道与 `context_window`；本机 Krill GPT-6.1 Sol 的接口 ID 为 `gpt-6.1-sol`，窗口为 `1000000`。

Node 只继承基本 PATH、独立 HOME、语言/时区和上述三项专用模型变量。运行证据会记录任务文本、命令、模型输出与错误；专用 API key 在 Node 输出边界脱敏，产物应留在本地。

## 运行单题（需要另行授权）

以下命令会创建任务容器、发起模型请求并执行 verifier，**仅在得到执行授权、选定模型、资源与架构准备完成后运行**。模型窗口变量必须来自所选模型的已核实目录。

从本目录执行；先通过安全方式设置上表环境变量，不要把凭据写入参数：

```bash
PYTHONPATH="$PWD" .venv/bin/harbor run \
  --registry-path ./registry.json \
  -d terminal-bench@2.0 -i regex-log \
  --env docker -a downcity_agent:DowncityAgent -m "$MODEL_ID" \
  -n 1 -k 1 -r 0 --delete \
  --ak max_model_calls=16 --ak max_tool_calls=32 \
  --ak suite=terminal-bench --ak task=regex-log --ak run_timeout_sec=900 \
  --jobs-dir ./artifacts/regex-log
```

DeepSWE 使用下列独立入口。本轮已通过公开 localnode 登录/exchange 取得新普通用户 token，并在内存及子进程环境传递；认证目录核实 Krill `gpt-6.1-sol`、窗口 1000000 后执行一次模型 attempt。后续重新执行仍需相应授权、资源检查和本轮新认证。当前本机没有 buildx，命令使用现有 legacy builder；这些环境变量仅影响当前进程，不修改 daemon：

```bash
export MODEL_ID=gpt-6.1-sol
export DOWNCITY_EVAL_BASE_URL=http://127.0.0.1:12314/v1/ai
export DOWNCITY_EVAL_CONTEXT_WINDOW=1000000
export DOCKER_BUILDKIT=0
export COMPOSE_BAKE=false
run_stamp=$(date -u +%Y%m%dT%H%M%SZ)
PYTHONPATH="$PWD" pier/.venv/bin/pier run \
  -p ./artifacts/deep-swe-435ee89ec2f2e2289f33b0da4f992f0b7b7266b9/tasks/anko-typed-variable-bindings \
  --env docker --agent-import-path downcity_pier_agent:DowncityPierAgent -m "$MODEL_ID" \
  -n 1 -k 1 -r 0 --no-delete \
  --ak suite=deep-swe --ak task=anko-typed-variable-bindings \
  --ak run_timeout_sec=5400 --ak max_model_calls=64 \
  --ak max_tool_calls=128 --ak max_output_tokens=4096 \
  --jobs-dir "./artifacts/anko-$run_stamp"
```

Pier Docker 的 `--no-delete` 清理路径执行 compose down，仍销毁任务容器/网络并保留镜像和卷；`--delete` 路径会附加 `--rmi all --volumes`，要求保留镜像/卷时应使用上面的 `--no-delete`。本轮原 CLI 使用过 `--delete`，实际命令与异常保留在报告中，verifier-only 续接使用 `stop(delete=False)`；不要改写历史运行参数。

`-r 0` 关闭 job 重试；Pier 0.3.1 仍有内部环境 setup timeout 重试，以及 verifier timeout 最多两次尝试。90 分钟 Agent 加 30 分钟 verifier 不构成 job 总上限，镜像/构建、collect、清理与内部重试会增加时间。较短 `run_timeout_sec` 必须记为额外 smoke 限制。

使用新 job 目录保留每次证据。不要用 `--no-delete` 保留任务计算环境，不要把 Docker socket、Downcity 数据根或宿主仓库挂入任务容器。Harbor 退出码和 SDK 的 `success` 只描述执行状态，最终成绩应查看 Harbor trial 的原始 verifier reward 与结果文件。

## 额度与取消

通过重复 `--ak key=value` 设置，未知键名直接拒绝：

| 参数 | 默认值 | 允许范围 / 含义 |
| --- | --- | --- |
| `max_model_calls` | 64 | 1–1024，真实 fetch 尝试数上限，包含 SDK 压缩/恢复等所有用途；禁止自动 redirect |
| `max_tool_calls` | 128 | 1–2048，包含失败调用；桥接最多同时等待 8 条命令 |
| `max_output_tokens` | 4096 | 1–32768，每次模型请求提交的输出 token 限制 |
| `max_context_bytes` | 524288 | 1024–1048576，标准 ModelCall JSON 的 UTF-8 字节上限，包含工具定义 |
| `max_output_bytes` | 32768 | 1024–131072，每条命令 stdout/stderr 各自保留的原始字节上限 |
| `command_timeout_sec` | 120 | 1–1200，命令可请求更短时限，不能超过此值 |
| `suite` | 入口对应值 | Harbor 只接受 `terminal-bench`；Pier 只接受 `deep-swe`，不能跨入口扩大时限 |
| `task` | suite 固定任务 | `regex-log` 或 `anko-typed-variable-bindings`；拒绝与 suite 来源不符的名称 |
| `run_timeout_sec` | Harbor 900；Pier 5400 | Harbor 1–1200，Pier 1–5400；原任务阶段时限仍可更早取消 |
| `cwd` | `/app` | 容器绝对目录；模型可以为单条命令指定其它容器绝对目录 |

请求数、JSON 字节数和本地证据容量由适配器控制；`max_output_tokens` 是发送给 Provider 的参数，不是整个评测的 token 或美元硬上限。没有估价预算或绝对金额上限，`cost_usd` 保持 null。需要金额控制时应同时使用模型服务端提供的额度。

命令通过 Bash job control 建立进程组，输出先在容器内有界保存并持续排空，避免宿主把无限输出完整读入内存。正常结束、命令超时和取消都会杀死普通子孙进程，因此不提供持久后台服务语义。命令超时返回 124；基础设施或桥接错误会使整轮失败。截断由 `truncated` 标记，UTF-8 边界外的残缺字节丢弃。单帧 JSONL 上限 2 MiB，单次模型 HTTP 响应上限 4 MiB；原生轨迹和 canonical 导出各最多 64 MiB，stderr 最多保存 64 KiB。

Node 收到取消时调用公开 `session.stop()` 并中止模型流、发出逐 request id 的 cancel。Python 对超时及 harness 外层 `asyncio` 取消都会停止 Node、在容器内标记取消并终止命令组和 wrapper；Node 最多等待 5 秒后强杀宿主子进程组。命令清理优先通过环境接口完成，随后才取消残余 Python 等待。清理错误会记入结果或使本轮失败。

进程组清理不能保证捕获主动 `setsid`/双重 fork 脱组的程序，也不能在 Docker daemon 无响应或宿主被 SIGKILL 时保证容器清理；harness 的最终环境销毁仍是完整清理边界。regex-log 已实测正常结束后的 Node 收口与题目容器删除；共享运行层提取后只做静态检查，故意取消/超时及 Pier 实际运行尚未实测。

## 证据和计量

每个 Harbor/Pier trial 的 agent 日志目录中会生成：

| 文件 | 内容 |
| --- | --- |
| `downcity-build-info.json` | 构建快照、当前 suite/task 和对应任务来源；DeepSWE 不使用 regex-log registry |
| `downcity-trajectory.jsonl` | 模型标准调用/事件、工具请求/响应、SDK mutation，带时间和调用 id |
| `downcity-messages.jsonl` | 公开 `session.messages()` 的全部 canonical 分页，每页内升序，文件按从新页到旧页保存 |
| `downcity-checkpoint.json` | 最新模型/工具调用数、逐调用计量和汇总，可保留中途取消证据 |
| `downcity-result.json` | Node 正常收口时的最终文本、成功/错误及 usage |
| `downcity-context.json` | Python 最终 AgentContext，包括失败类别、时长、资源配置与清理状态 |
| `downcity-stderr.log` | 有界运行诊断 |

同一调用收到多次 `model_usage` 时只覆盖该调用的累计值；不同调用才相加。未收到 `model_finish` 的中断调用、缺失的缓存写入/推理指标等不会补零，汇总保留 null，逐调用原始计量仍可审计。Harbor/Pier `n_input_tokens` 包含缓存输入，`n_cache_tokens` 单独回填已知缓存命中，未取得 Provider 金额时不填写成本。当前公开 Chat Completions 适配器要求 Provider 返回 usage，缺失时 SDK 会报错。

被强杀或基础设施故障时，最终文本、canonical 消息或最终结果文件可能不存在，应检查 checkpoint 和已落盘轨迹，不能把缺失文件当成成功。这里保存 Downcity 原生轨迹，`SUPPORTS_ATIF=false`，不伪装 ATIF 或 FrontierHarness 官方提交产物。

## 非运行验证

已使用本机 Node 26.11.1、Python 3.13.16 完成 SDK/共享类型/Downtown 无 bump 构建，以及适配器 TypeScript 类型检查/构建、三个 Python 模块编译、Harbor 0.22.0 与 Pier 0.3.1 公开工厂 import/构造、AgentConfig 和 context 回填、suite/task/时限非法参数拒绝、固定任务配置与文件哈希校验、CLI `run --help` 和完整命令参数解析、Bash 语法检查。完整 CLI 通过 Click/Typer `make_context` 解析，未调用执行 callback 或 Docker preflight。没有新增测试用例；实际 regex-log 与 Anko 的运行证据见上方报告；Anko 原始分数及构建/判题续接限制须同时阅读。

可重复的静态检查：

```bash
node build.mjs --typecheck
node build.mjs
node --check dist/downcity_runner.js
.venv/bin/python -m py_compile eval_runtime.py downcity_agent.py
pier/.venv/bin/python -m py_compile downcity_pier_agent.py
bash -n container_command.sh
.venv/bin/harbor run --help
pier/.venv/bin/pier run --help
```

`.venv/`、`node_modules/`、`dist/`、`artifacts/` 与本地凭据文件不进入 Git。核心 SDK、City、CLI 与 homepage 未作功能修改，不触发 package bump。

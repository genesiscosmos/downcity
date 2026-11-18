"""Harbor 0.22.0 外部 BaseAgent：Node SDK 与当前任务环境的唯一桥接。

任务命令、取消与清理全部通过 BaseEnvironment.exec；不执行模型指定的宿主命令。
Node 为一次性子进程，宿主只持有模型连接和证据文件。无 ATIF 声明、无 City。
"""

import asyncio
import base64
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import time
from typing import Any
from uuid import uuid4

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

EVAL_DIR = Path(__file__).resolve().parent
MAX_FRAME_BYTES = 2 * 1024 * 1024
LIMITS = {
    "max_model_calls": (64, 1, 1024),
    "max_tool_calls": (128, 1, 2048),
    "max_output_tokens": (4096, 1, 32768),
    "max_context_bytes": (524288, 1024, 1048576),
    "max_output_bytes": (32768, 1024, 131072),
    "command_timeout_sec": (120, 1, 1200),
    "run_timeout_sec": (900, 1, 1200),
}

# 取消标记先落盘；wrapper 在启动前与登记 pid 后均检查，避免遗漏早到取消。
CLEANUP_SOURCE = """
state_dir=$1
shift
for request_id in "$@"; do
    touch "$state_dir/$request_id.cancel" || exit 125
    pid_file="$state_dir/$request_id.pid"
    if [ -f "$pid_file" ]; then
        read -r command_pid < "$pid_file" || true
        case "$command_pid" in
            ''|*[!0-9]*) exit 125 ;;
        esac
        kill -KILL -- "-$command_pid" 2>/dev/null || true
    fi
    wrapper_file="$state_dir/$request_id.wrapper"
    if [ -f "$wrapper_file" ]; then
        read -r wrapper_pid < "$wrapper_file" || true
        case "$wrapper_pid" in
            ''|*[!0-9]*) exit 125 ;;
        esac
        kill -TERM -- "$wrapper_pid" 2>/dev/null || true
    fi
done
"""


class DowncityAgent(BaseAgent):
    """只提供受限容器终端的 Downcity SDK smoke 配置。"""

    SUPPORTS_ATIF = False

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """资源限制由 --ak 传入，超范围或非整数配置在创建容器前失败。"""
        self.config: dict[str, Any] = {}
        for key, (default, minimum, maximum) in LIMITS.items():
            value = kwargs.pop(key, default)
            if isinstance(value, bool) or not str(value).isdigit():
                raise ValueError(f"{key} must be an integer")
            number = int(value)
            if not minimum <= number <= maximum:
                raise ValueError(f"{key} must be in {minimum}..{maximum}")
            self.config[key] = number
        cwd = kwargs.pop("cwd", "/app")
        if not isinstance(cwd, str) or not cwd.startswith("/") or "\0" in cwd:
            raise ValueError("cwd must be a container absolute path")
        self.config["cwd"] = cwd
        allowed_kwargs = {"logs_dir", "model_name", "logger", "mcp_servers", "skills_dir", "extra_env",
                          "load_trajectory", "environment_logs_dir"}
        if set(kwargs) - allowed_kwargs:
            raise ValueError("Unknown adapter keyword; check README --ak names")
        super().__init__(*args, **kwargs)
        if importlib.metadata.version("harbor") != "0.22.0":
            raise RuntimeError("This adapter requires harbor==0.22.0")
        if not self.model_name:
            raise ValueError("Specify the exact upstream model name using -m")
        if self.mcp_servers or self.skills_dir or self.load_trajectory:
            raise ValueError("This smoke adapter does not accept MCP, skills or trajectory loading")
        self.node_path = shutil.which("node")
        if not self.node_path or not (EVAL_DIR / "dist/downcity_runner.js").is_file():
            raise RuntimeError("Node and the built runner are required; run node build.mjs first")
        self.state_dir = f"/tmp/downcity-eval-{uuid4().hex}"
        self.commands: dict[str, asyncio.Task[None]] = {}
        self.command_ids: set[str] = set()
        self.write_lock = asyncio.Lock()
        self.child: asyncio.subprocess.Process | None = None
        self.last_checkpoint: dict[str, Any] = {}
        self.bridge_error: str | None = None
        self.accepting_commands = True

    @staticmethod
    def name() -> str:
        """Harbor 成绩记录中的 agent 名称。"""
        return "downcity-sdk-terminal-smoke"

    @staticmethod
    def version() -> str:
        """适配协议版本；实际 SDK 版本与内容哈希另存 build-info。"""
        return "0.1.0"

    async def setup(self, environment: BaseEnvironment) -> None:
        """只检查容器既有 Bash/coreutils 并创建命令登记目录，不安装工具。"""
        source = 'for tool in head cat timeout base64 wc mkfifo sleep touch mkdir rm; do command -v "$tool" >/dev/null || exit 125; done; mkdir -m 700 -- "$1"'
        command = shlex.join(["/bin/bash", "-c", source, "_", self.state_dir])
        result = await environment.exec(command, cwd=self.config["cwd"], timeout_sec=15)
        if result.return_code != 0:
            raise RuntimeError("Task container requires existing /bin/bash, coreutils and configured cwd")

    def runner_env(self) -> dict[str, str]:
        """Node 仅继承运行必需项和专用模型变量；不转发其它服务凭据。"""
        home_dir = self.logs_dir / "runtime-home"
        home_dir.mkdir(parents=True, exist_ok=True)
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home_dir.resolve()),
               "LANG": "C.UTF-8", "TZ": "UTC"}
        for key in ("DOWNCITY_EVAL_API_KEY", "DOWNCITY_EVAL_BASE_URL", "DOWNCITY_EVAL_CONTEXT_WINDOW"):
            value = self.extra_env.get(key, os.environ.get(key))
            if not value:
                raise RuntimeError(f"Missing required environment key: {key}")
            env[key] = value
        return env

    async def send(self, message: dict[str, Any]) -> None:
        """串行写完整 JSONL 帧，避免并发命令响应相互交错。"""
        payload = (json.dumps(message, ensure_ascii=True) + "\n").encode()
        if len(payload) > MAX_FRAME_BYTES:
            raise RuntimeError("Outgoing bridge frame exceeds limit")
        async with self.write_lock:
            if self.child is None or self.child.stdin is None:
                raise RuntimeError("Node bridge not started")
            self.child.stdin.write(payload)
            await self.child.stdin.drain()

    def update_context(self, context: AgentContext, message: dict[str, Any]) -> None:
        """未知 usage 保持 None；不根据 token 估算金额。"""
        self.last_checkpoint = message
        usage = message.get("usage", {})
        for field, key in (("n_input_tokens", "input_tokens"), ("n_output_tokens", "output_tokens"),
                           ("n_cache_tokens", "cached_input_tokens")):
            value = usage.get(key)
            if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
                raise RuntimeError("Invalid usage checkpoint")
            setattr(context, field, value)
        context.cost_usd = None
        context.metadata = {
            "methodology_comparable": False, "configuration": "sdk_terminal_smoke",
            "harbor_version": "0.22.0", "adapter_version": self.version(),
            "model_name": self.model_name, "limits": self.config,
            "model_calls": message.get("model_calls", 0), "tool_calls": message.get("tool_calls", 0),
            "usage": usage, "cost_usd": None, "usage_source": "last_cumulative_value_per_call",
            "supports_atif": False,
            "task_sources": json.loads((EVAL_DIR / "sources.json").read_text()),
        }
        (self.logs_dir / "downcity-checkpoint.json").write_text(json.dumps(message, indent=2) + "\n")

    async def cleanup_commands(self, environment: BaseEnvironment, ids: list[str]) -> None:
        """先在容器内取消并杀进程组，再允许取消外层 Docker CLI 等待。"""
        if not ids:
            return
        command = shlex.join(["/bin/bash", "-c", CLEANUP_SOURCE, "_", self.state_dir, *ids])
        result = await environment.exec(command, timeout_sec=5)
        if result.return_code != 0:
            raise RuntimeError("Container command cleanup failed; Harbor must remove the environment")

    async def execute(self, environment: BaseEnvironment, request: dict[str, Any]) -> None:
        """通过容器 wrapper 在源头截断输出；故障作为协议错误传播。"""
        request_id = request["id"]
        try:
            command = request.get("command")
            cwd = request.get("cwd", self.config["cwd"])
            timeout_sec = request.get("timeout_sec", self.config["command_timeout_sec"])
            if not isinstance(command, str) or not command or len(command.encode()) > 65536 or "\0" in command:
                raise ValueError("Invalid command")
            if not isinstance(cwd, str) or not cwd.startswith("/") or "\0" in cwd:
                raise ValueError("Invalid container cwd")
            if type(timeout_sec) is not int or not 1 <= timeout_sec <= self.config["command_timeout_sec"]:
                raise ValueError("Invalid command timeout")
            source = (EVAL_DIR / "container_command.sh").read_text()
            wrapped = shlex.join(["/bin/bash", "-c", source, "_", self.state_dir, request_id, command,
                                  cwd, str(timeout_sec), str(self.config["max_output_bytes"])]) + " 2>/dev/null"
            result = await environment.exec(wrapped, cwd=cwd, timeout_sec=timeout_sec + 10)
            if result.return_code != 0:
                raise RuntimeError("Container command wrapper failed")
            lines = (result.stdout or "").splitlines()
            if len(lines) != 4 or lines[1] not in ("true", "false"):
                raise RuntimeError("Invalid container wrapper output")
            response = {
                "return_code": int(lines[0]), "truncated": lines[1] == "true",
                "stdout": base64.b64decode(lines[2], validate=True).decode("utf-8", errors="ignore"),
                "stderr": base64.b64decode(lines[3], validate=True).decode("utf-8", errors="ignore"),
            }
            await self.send({"type": "exec_result", "id": request_id, "result": response})
        except asyncio.CancelledError:
            raise
        except Exception as error:
            # 不转发异常正文，避免 Docker/Provider 的环境信息混入模型或凭据日志。
            self.bridge_error = f"Container exec failed: {type(error).__name__}"
            try:
                await self.send({"type": "exec_result", "id": request_id, "error": self.bridge_error})
            except (BrokenPipeError, ConnectionResetError):
                pass
        finally:
            self.commands.pop(request_id, None)

    async def read_bridge(self, environment: BaseEnvironment, context: AgentContext) -> dict[str, Any]:
        """有界解析子进程输出；多命令通过 request id 路由，协议错误立即失败。"""
        assert self.child and self.child.stdout
        while line := await self.child.stdout.readline():
            if len(line) > MAX_FRAME_BYTES:
                raise RuntimeError("Incoming bridge frame exceeds limit")
            message = json.loads(line)
            kind = message.get("type")
            if kind in ("checkpoint", "result"):
                self.update_context(context, message)
                if kind == "result":
                    return message
            elif kind in ("exec", "cancel"):
                request_id = message.get("id", "")
                if not isinstance(request_id, str) or not re.fullmatch(r"[0-9a-f-]{36}", request_id):
                    raise RuntimeError("Invalid bridge request id")
                if kind == "cancel":
                    if request_id in self.command_ids:
                        await self.cleanup_commands(environment, [request_id])
                else:
                    if not self.accepting_commands or request_id in self.command_ids or len(self.commands) >= 8:
                        raise RuntimeError("Duplicate request or too many concurrent commands")
                    if len(self.command_ids) >= self.config["max_tool_calls"]:
                        raise RuntimeError("max_tool_calls reached in Python bridge")
                    self.command_ids.add(request_id)
                    self.commands[request_id] = asyncio.create_task(self.execute(environment, message))
            else:
                raise RuntimeError("Unknown bridge message type")
        raise RuntimeError("Node exited without a result frame")

    async def drain_stderr(self) -> None:
        """持续排空但只保存 64 KiB stderr；不把密钥或任意诊断复制到聊天。"""
        assert self.child and self.child.stderr
        kept = 0
        # Node 已在输出边界对专用 API key 脱敏。
        with (self.logs_dir / "downcity-stderr.log").open("wb") as output:
            while chunk := await self.child.stderr.read(8192):
                remaining = max(0, 65536 - kept)
                output.write(chunk[:remaining])
                kept += len(chunk[:remaining])

    async def shutdown(self, environment: BaseEnvironment) -> None:
        """终止 Node 进程组与全部命令；Harbor 保留环境最终销毁的所有权。"""
        self.accepting_commands = False
        if self.child and self.child.returncode is None:
            try:
                os.killpg(self.child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        cleanup_error: Exception | None = None
        try:
            await self.cleanup_commands(environment, list(self.command_ids))
        except Exception as error:
            cleanup_error = error
        tasks = list(self.commands.values())
        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=3)
            for task in pending:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        if self.child:
            try:
                await asyncio.wait_for(self.child.wait(), timeout=5)
            except TimeoutError:
                try:
                    os.killpg(self.child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await self.child.wait()
            if self.child.stdin:
                self.child.stdin.close()
        if cleanup_error:
            raise cleanup_error

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        """执行一次 Agent 阶段；成功只代表 SDK 完成，分数由原始 verifier 决定。"""
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.update_context(context, {"usage": {}, "model_calls": 0, "tool_calls": 0})
        stderr_task: asyncio.Task[None] | None = None
        started_at = time.monotonic()
        failure: BaseException | None = None
        try:
            env = self.runner_env()
            self.child = await asyncio.create_subprocess_exec(
                self.node_path, str(EVAL_DIR / "dist/downcity_runner.js"),
                cwd=EVAL_DIR, env=env, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                limit=MAX_FRAME_BYTES + 1, start_new_session=True,
            )
            stderr_task = asyncio.create_task(self.drain_stderr())
            async with asyncio.timeout(self.config["run_timeout_sec"]):
                await self.send({"type": "init", "instruction": instruction, "model_name": self.model_name,
                                 "config": self.config, "logs_dir": str(self.logs_dir.resolve())})
                result = await self.read_bridge(environment, context)
                await asyncio.wait_for(self.child.wait(), timeout=5)
                if not result.get("success") or self.child.returncode != 0 or self.bridge_error:
                    raise RuntimeError(self.bridge_error or result.get("error") or "Downcity SDK execution failed")
        except BaseException as error:
            failure = error
            raise
        finally:
            try:
                await self.shutdown(environment)
            except Exception as error:
                context.metadata["cleanup_failed"] = True
                if failure is None:
                    failure = error
                    raise
            finally:
                if stderr_task:
                    await asyncio.gather(stderr_task, return_exceptions=True)
                context.metadata["elapsed_sec"] = round(time.monotonic() - started_at, 3)
                context.metadata["failure_kind"] = type(failure).__name__ if failure else None
                (self.logs_dir / "downcity-context.json").write_text(context.model_dump_json(indent=2) + "\n")

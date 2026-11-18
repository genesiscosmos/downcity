"""Pier 0.3.1 DeepSWE 入口：模型在宿主，终端只访问 Pier 当前任务环境。

显式持有 BaseAgent 未初始化的 extra_env/load_trajectory 配置；拒绝恢复旧轨迹。
不提供安装脚本与网络域名，禁网容器不接收模型 key、代理或宿主文件。
"""

import importlib.metadata
from pathlib import Path
from typing import Any

from pier.agents.base import BaseAgent
from pier.environments.base import BaseEnvironment
from pier.models.agent.context import AgentContext
from pier.models.agent.install import AgentInstallSpec
from pier.models.agent.network import NetworkAllowlist

from eval_runtime import EvalRuntime


class DowncityPierAgent(BaseAgent):
    """Pier 专用薄入口，共享 SDK 轨迹、用量、终端与取消生命周期。"""

    SUPPORTS_ATIF = False

    def __init__(self, logs_dir: Path, model_name: str | None = None, **kwargs: Any) -> None:
        """仅接受已固定的 suite 与公开 BaseAgent 参数。"""
        if (importlib.metadata.version("datacurve-pier") != "0.3.1"
                or importlib.metadata.version("harbor") != "0.22.0"):
            raise RuntimeError("This adapter requires datacurve-pier==0.3.1 and harbor==0.22.0")
        suite = kwargs.pop("suite", "deep-swe")
        if suite != "deep-swe":
            raise ValueError("Pier entry requires suite=deep-swe")
        self.extra_env = dict(kwargs.pop("extra_env", None) or {})
        self.load_trajectory = kwargs.pop("load_trajectory", None)
        if self.load_trajectory:
            raise ValueError("This adapter does not accept trajectory loading")
        base_keys = ("logger", "mcp_servers", "skills_dir")
        base_kwargs = {key: kwargs.pop(key) for key in base_keys if key in kwargs}
        super().__init__(logs_dir=logs_dir, model_name=model_name, **base_kwargs)
        if self.mcp_servers or self.skills_dir:
            raise ValueError("This adapter does not accept MCP or skills")
        self.runtime = EvalRuntime(self.logs_dir, self.model_name, suite, self.extra_env, **kwargs)

    @staticmethod
    def name() -> str:
        """Pier 结果中使用的受限 SDK agent 名称。"""
        return EvalRuntime.name()

    @staticmethod
    def version() -> str:
        """返回共享适配协议版本。"""
        return EvalRuntime.version()

    def install_spec(self) -> AgentInstallSpec | None:
        """SDK 在宿主运行，不在禁网任务镜像中安装 agent。"""
        return None

    def network_allowlist(self) -> NetworkAllowlist:
        """空域名列表保留任务原始 no-network 约束。"""
        return NetworkAllowlist()

    async def setup(self, environment: BaseEnvironment) -> None:
        """只检查任务环境已有工具并创建命令登记目录。"""
        await self.runtime.setup(environment)

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        """执行单次 SDK 阶段；collect 与 separate verifier 由 Pier 负责。"""
        await self.runtime.run(instruction, environment, context)

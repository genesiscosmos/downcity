"""Harbor 0.22.0 入口：保留 regex-log 契约，组合共享 SDK 终端运行层。

Harbor 持有任务与 verifier；本入口只做公开 BaseAgent 初始化和方法转发。
不提供 Workspace、files、容器内模型凭据、MCP 或轨迹恢复。
"""

import importlib.metadata
from pathlib import Path
from typing import Any

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from eval_runtime import EvalRuntime


class DowncityAgent(BaseAgent):
    """Harbor 专用薄入口；其依赖不进入 Pier 或公共运行层。"""

    SUPPORTS_ATIF = False

    def __init__(self, logs_dir: Path, model_name: str | None = None, **kwargs: Any) -> None:
        """区分 BaseAgent 配置与 adapter 参数，在创建环境前校验。"""
        if importlib.metadata.version("harbor") != "0.22.0":
            raise RuntimeError("This adapter requires harbor==0.22.0")
        suite = kwargs.pop("suite", "terminal-bench")
        if suite != "terminal-bench":
            raise ValueError("Harbor entry requires suite=terminal-bench")
        base_keys = ("logger", "mcp_servers", "skills_dir", "extra_env", "load_trajectory", "environment_logs_dir")
        base_kwargs = {key: kwargs.pop(key) for key in base_keys if key in kwargs}
        super().__init__(logs_dir=logs_dir, model_name=model_name, **base_kwargs)
        if self.mcp_servers or self.skills_dir or self.load_trajectory:
            raise ValueError("This adapter does not accept MCP, skills or trajectory loading")
        self.runtime = EvalRuntime(self.logs_dir, self.model_name, suite, self.extra_env, **kwargs)

    @staticmethod
    def name() -> str:
        """保持已实测 Harbor agent 名称。"""
        return EvalRuntime.name()

    @staticmethod
    def version() -> str:
        """返回独立评测适配协议版本。"""
        return EvalRuntime.version()

    async def setup(self, environment: BaseEnvironment) -> None:
        """检查任务容器既有工具并创建命令登记目录。"""
        await self.runtime.setup(environment)

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        """执行 SDK 阶段并回填 Harbor context；verifier 独立评分。"""
        await self.runtime.run(instruction, environment, context)

---
title: "Agent Memory 全生态复盘与 Downcity MemoryPlugin 底座调研"
date: 2026-08-11
type: solution
quality_score: 4.6
word_count: 11200
status: final
hypothesis: "如果 Downcity 让一个 MemoryProvider 成为唯一事实源，由 Provider 独占记忆语义，并将存储与索引下沉为内部 Adapter，那么它会比直接绑定文件目录、向量库或单一 Memory SaaS 更可靠、更可迁移。"
validation_rate: 80%
---

# Agent Memory 全生态复盘与 Downcity MemoryPlugin 底座调研

> 调研范围：面向 AI Agent 的跨会话记忆、上下文压缩、用户画像、经验学习、时态知识、coding-agent memory、模型/框架原生能力、云托管 Memory 服务、底层索引与评测。
>
> 调研时间：2026-08-11。市场变化很快，GitHub 数据与产品能力均为该日期快照。
>
> 覆盖口径：30+ 个主流或具有代表性的产品/框架，以及向量、全文、图与关系数据库等基础设施类别；不把只有少量实验代码的长尾仓库逐一列为市场方案。

## 一、执行摘要

结论先行：**整个 Agent Memory 生态没有一个可以覆盖所有职责的“最佳产品”。Downcity 不应该把 `MemoryPlugin` 直接改造成 Mem0、Zep、Hindsight、文件系统或某个向量数据库的薄封装。最适合的底座是“可替换的单一 MemoryProvider + Provider 内部 Adapter”。**

Downcity 的 LLM Wiki 可以继续作为 Builtin Provider 的一种人类可读投影，但不能成为 MemoryPlugin 的领域协议。Markdown、JSONL、SQLite、向量库和远程服务都只是 Provider 背后的实现。真正的问题不是“没有向量库”，而是过去把文件路径、存储、提炼、关键词扫描和上下文注入直接写进了 Plugin，使第三方 Memory Engine 无法替换整套语义。

建议的目标架构：

```text
Session / Tool Result / Manual Input / External Data
                         ↓
             Immutable Evidence Ledger
                         ↓
        Extract / Consolidate / Invalidate / Reflect
                         ↓
    Profile | Facts | Episodes | Procedures | Wiki Pages
                         ↓
     BM25/FTS | Vector | Graph | Temporal | Metadata
                         ↓
          Hybrid Retrieval + Context Assembly
                         ↓
                    Agent Prompt
```

产品选择上：

- **默认本地 Provider**：由 `BuiltinMemoryProvider` 实现记忆形成、召回、修订和删除；文件、SQLite FTS 或向量索引均作为内部 Adapter。它最符合 Downcity 的本地优先、透明、可恢复和不锁定供应商的产品意图。
- **第一个通用商业/托管适配器**：优先 Mem0。它的生态、SDK、托管与自部署路径最成熟，适合快速验证用户画像和事实记忆，但不应成为核心数据模型。
- **第一个高级开源 Memory Engine 适配器**：Hindsight 或 Graphiti 二选一。Hindsight 的 `retain / recall / reflect`、多路检索与 evidence-grounded observation 更完整；Graphiti 的双时态事实、来源追踪和增量知识图谱更适合业务事实持续变化的场景。
- **Agent 自管理上下文的参考实现**：Letta。它的 always-visible memory blocks、archival memory 和共享 block 很有价值，但 Letta 是完整 stateful-agent runtime，不适合反向成为 Downcity Plugin 的基础依赖。
- **模型原生文件 Memory 的兼容目标**：Anthropic Memory Tool。它验证了“文件是可行的 Agent Memory API”，但只是工具协议，不负责提炼、检索排序或事实冲突处理。

Hermes 的 8 个 provider 已单独整理在[专题报告](./hermes-memory-providers-research.md)中；它们应放回整个生态地图理解：Honcho、OpenViking、Mem0、Hindsight、Holographic、RetainDB、ByteRover、Supermemory 分别代表用户建模、Context Database、通用事实层、学习型 Engine、本地事实库、coding memory、知识树和托管 Context Platform，并不是同一层的竞品。

本报告的核心判断为高置信度；各厂商宣称的 benchmark 排名只能作为中低置信度证据，因为测试模型、prompt、上下文预算和评判器经常不同，且大量分数由厂商自行报告。

## 二、研究问题与初始假设

### 2.1 要回答的决策

本次调研不是寻找“最强向量数据库”，而是回答三个工程问题：

1. 市场上的 Agent Memory 方案分别解决哪一层问题？
2. Downcity 当前 LLM Wiki 相比这些方案缺少什么，哪些反而是优势？
3. `MemoryPlugin` 最适合以什么协议和默认实现作为底座？

### 2.2 Day One Hypothesis

> 如果 Downcity 把不可变原始证据作为事实来源，把整理后的 Wiki、用户画像和经验总结视为可重建投影，并让索引、检索、提炼、失效与上下文组装均可替换，那么它会比直接绑定向量库或单一 Memory SaaS 更可靠、更可迁移，因为 Agent Memory 的核心难点是事实生命周期与上下文决策，不是文本持久化。

### 2.3 假设树与验证结果

| 子假设 | 结果 | 置信度 | 关键证据 |
|---|---|---|---|
| H1：Memory 不等于聊天记录或向量检索 | 验证 | 高 | LongMemEval 将问题拆为 indexing、retrieval、reading，并要求知识更新、时态推理和 abstention |
| H2：来源、时间和冲突处理比纯 similarity 更重要 | 验证 | 高 | Zep/Graphiti、Hindsight、LangMem 都显式处理来源、时间、重要性或记忆强度 |
| H3：人可读文件可以作为可靠 Memory 形态 | 验证 | 高 | Anthropic Memory Tool 已将文件式 memory 作为正式模型工具；A-MEM 使用动态笔记网络 |
| H4：一个外部 Memory 产品可以覆盖全部场景 | 否定 | 高 | Mem0、Zep、Letta、OpenAI Sessions 与 Anthropic Memory Tool 的职责层级明显不同 |
| H5：Downcity 应立即以知识图谱替换 Wiki | 否定 | 中高 | 图谱增强时态与多跳，但带来模型提取、图数据库、ontology 和运维复杂度；多数场景先需要可靠 ledger 与混合检索 |

验证率按“验证或明确否定并形成决策”的子假设计算为 80%。

## 三、先统一概念：市场方案不在同一层

Agent Memory 至少包含六种不同对象。混淆它们会导致 API 设计失控。

| 层级 | 保存什么 | 典型生命周期 | 代表方案 |
|---|---|---|---|
| Thread / Checkpoint | 消息、工具调用、工作流状态 | 单 session 或可恢复执行 | OpenAI Agents Sessions、LangGraph Checkpointer |
| Working Memory | 当前目标、计划、scratchpad、始终可见状态 | 当前任务，频繁更新 | Letta Memory Blocks、Agent state |
| Semantic Memory | 用户偏好、事实、概念、当前画像 | 跨 session，可更新或失效 | Mem0、Memobase、LangMem Profile |
| Episodic Memory | 过去事件、执行轨迹、成功/失败经验 | 跨 session，按情境召回 | Hindsight Experience、LangMem Episodes |
| Procedural Memory | 行为规则、风格、技能与经验策略 | 长期，受审批与版本控制 | LangMem Procedural、Letta persona/policy block |
| Knowledge / Context Memory | 文档、业务对象、关系、历史事实 | 外部数据持续同步 | Zep、Graphiti、Cognee、Supermemory |

此外，向量库、图数据库和全文索引只是底层索引，不等同于完整 Memory：

- Qdrant、Pinecone、Weaviate、Milvus、Chroma、pgvector 解决 embedding 相似检索。
- Neo4j、FalkorDB、Neptune 解决实体关系和图遍历。
- SQLite FTS、PostgreSQL FTS、Elasticsearch/OpenSearch 解决关键词、过滤和排序。
- 真正的 Memory Engine 还需要决定什么值得记、如何作用域隔离、如何合并冲突、何时遗忘、如何引用来源、如何控制上下文预算。

LangMem 用 semantic、episodic、procedural 三分法解释长期记忆，同时明确记忆设计必须回答 What、When、Where；它还指出召回不能只看语义相似度，还要考虑 importance、recency 和 strength（[LangMem Conceptual Guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)）。这一框架适合作为 Downcity 的领域词汇基础。

### 3.1 2026 年生态全景

把产品和基础设施混在一张排行榜里没有意义。当前生态至少分为以下八层：

| 生态层 | 解决的问题 | 主流代表 |
|---|---|---|
| 模型/产品原生 | 模型如何读写文件记忆、产品如何保存用户偏好 | Anthropic Memory Tool、ChatGPT Memory、Claude/Codex 项目文件 |
| Session/Framework | 消息持久化、checkpoint、working memory、框架 store | OpenAI Agents Sessions、LangGraph/LangMem、Mastra、LlamaIndex、CrewAI、AutoGen、Google ADK |
| 通用 Memory API | 从对话抽取事实、画像、scope 和检索 | Mem0、Memobase、Memori、memU |
| Learning/Reflection Engine | 从经历形成 observation、mental model、procedure | Hindsight、Mastra Observational Memory、MemoryOS、MIRIX |
| Temporal/Graph Memory | 实体关系、来源、多跳、事实有效期 | Zep/Graphiti、Cognee、Hindsight、MIRIX |
| Context Database/Knowledge Hub | Memory、文档、代码、Skill 和团队资产统一治理 | OpenViking、Supermemory、TencentDB Agent Memory、EverOS |
| Local/Coding Memory | 本地项目决策、会话交接、可移植知识和审阅 | claude-mem、RetainDB Local、ByteRover、Memvid、Holographic、EverOS、memU |
| 托管云服务 | 多租户、合规、托管抽取和可用性 | AWS AgentCore Memory、Google Memory Bank、Zep Cloud、Mem0 Platform、Supermemory Cloud、Honcho Cloud |
| 存储与索引 | FTS、vector、graph、metadata、object storage | SQLite/Postgres FTS、pgvector、Qdrant、Pinecone、Weaviate、Milvus、Neo4j、FalkorDB |

生态正在从“给聊天记录做 embedding”向四个方向演进：**可追溯事实生命周期、后台 observation/reflection、项目与团队 Memory Asset、以及本地可移植的文件/单库格式**。这也是为什么单一向量库越来越难被称为完整 Agent Memory。

## 四、主流专用 Agent Memory 平台

### 4.1 Mem0

Mem0 是当前生态覆盖最广的通用 Memory Layer。其开源版可作为 Python/TypeScript library 或自托管 server；默认 library 组合是 LLM + embedding + Qdrant + SQLite history，自托管 server 默认使用 Postgres/pgvector。它通过 `add` 从消息中抽取记忆，以 `user_id / agent_id / app_id / run_id` 等标识作用域，并提供搜索、更新、删除、历史和过期能力（[Mem0 OSS Overview](https://docs.mem0.ai/open-source/overview)、[Memory Operations](https://docs.mem0.ai/core-concepts/memory-operations)）。

Mem0 论文将系统描述为“抽取、合并、检索显著事实”，并报告相对 full-context 显著降低延迟和 token 成本；Graph Memory 变体进一步处理关系（[Mem0 Paper](https://arxiv.org/abs/2504.19413)）。这些结果来自 Mem0 团队，应视为厂商自评而非独立结论。

优点：

- API 简单，用户/Agent/session scope 明确。
- OSS、托管、Python 与 TypeScript 生态完整。
- 支持多种 LLM、embedding、vector store 与 reranker。
- 有 memory history、expiration 和 dashboard，较接近生产产品。

局限：

- 基础心智模型仍以原子事实 + 向量召回为主。
- 自动抽取和合并受 LLM 稳定性影响。
- 作为核心依赖会把 Downcity 的 identity、scope、删除和历史语义映射到 Mem0 模型。

判断：**最适合作为 Downcity 的第一个 SaaS/通用 Provider，但不适合作为全部场景的默认唯一实现。**

截至调研日，[mem0ai/mem0](https://github.com/mem0ai/mem0) 约 6.3 万 stars，Apache-2.0，项目活跃；这是生态成熟度信号，不代表记忆准确率。

### 4.2 Zep 与 Graphiti

Zep 将自己定位为企业级 context infrastructure。它把聊天、业务数据、文档和 JSON 构造成 temporal Context Graph，输出 facts、entities、episodes、thread summaries、observations 和 user summary；旧事实不会简单覆盖，而是记录有效和失效时间（[Zep Docs](https://help.getzep.com/)）。

Graphiti 是 Zep 核心时态图引擎的开源版本。它保存 entities、带 validity window 的 facts/relationships、以及作为 provenance 的 episodes，并组合 semantic、BM25 和 graph traversal 检索。Graphiti 支持 Neo4j、FalkorDB、Neptune 等后端，而托管 Zep 使用自有 Context Graph Engine（[Graphiti GitHub](https://github.com/getzep/graphiti)）。

Zep 论文在 DMR 与 LongMemEval 上报告超过 MemGPT 和若干 baseline，但同样由厂商团队发布（[Zep Paper](https://arxiv.org/abs/2501.13956)）。

优点：

- 对变化中的事实和历史查询建模最清晰。
- 原始 episode 到派生事实有来源链路。
- 适合企业对象、用户关系和跨数据源持续更新。
- 开源 Graphiti 与托管 Zep 形成两种部署选择。

局限：

- 图构建依赖 LLM 提取与实体归一化。
- 自托管需要图数据库、embedding、LLM 和更多运维。
- 对简单个人偏好或项目 Wiki 可能明显过度设计。

判断：**Graphiti 是 Downcity 时态事实和关系型 Memory 的最佳参考/高级 provider，但不应替换默认 Wiki。**

### 4.3 Letta / MemGPT

MemGPT 提出了类似操作系统虚拟内存的分层上下文管理：模型在有限 context window 与更大外部存储之间移动数据（[MemGPT Paper](https://arxiv.org/abs/2310.08560)）。商业化后的 Letta 更接近完整 stateful-agent runtime，而非独立 memory database。

Letta 的 Memory Blocks 是始终位于上下文中的结构化块，可由 Agent 自主更新，也可以共享给多个 Agent或设为只读；典型块包括 `human`、`persona`、policy 和 scratchpad。更大内容进入 archival memory，通过工具按需召回（[Letta Memory Blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks/)）。

优点：

- 清楚区分 always-visible core memory 与 archival memory。
- Agent 自主管理记忆，支持共享 block 和 read-only policy。
- 将记忆、上下文预算和 Agent 生命周期统一考虑。

局限：

- Letta 本身拥有 Agent runtime、message、tool、block 和 archive 生命周期。
- 直接嵌入会与 Downcity Agent/Session 的所有权重叠。
- always-visible block 如果治理不当会污染 system context。

判断：**应吸收其 memory block 与分层上下文设计，不应把 Letta runtime 当作 Plugin 底座。**

### 4.4 Hindsight

Hindsight 以 `retain / recall / reflect` 为核心协议，将记忆分为 world facts、experience facts、自动归纳的 observations 和用户维护的 mental models。其 TEMPR 检索并行执行 semantic、BM25、graph 和 temporal 四路搜索，再融合与 rerank；observation 保留支持它的原始证据和 proof count，并在新证据到来时更新而非直接覆盖（[Hindsight Docs](https://hindsight.vectorize.io/)、[GitHub](https://github.com/vectorize-io/hindsight)）。

优点：

- 在“记住事实”之外显式建模“从经验学习”。
- 混合检索、时态查询、证据引用和 consolidation 组合完整。
- MIT 开源，支持服务、Docker 和嵌入式运行，并有 TypeScript client。
- `retain / recall / reflect` 很接近可复用的 Memory SPI。

局限：

- 项目创建于 2025 年末，生产历史短于 Mem0/Zep/Letta。
- SOTA benchmark 主要来自项目自身与合作方声明，需 Downcity 独立复测。
- 完整 reflect 引入额外模型成本和不可预测延迟。

判断：**Hindsight 是当前最值得 Downcity借鉴的完整 Memory Engine 架构，也是高级开源 provider 的强候选，但成熟度仍需基准测试验证。**

### 4.5 Cognee

Cognee 把原始文档处理成 chunks、entities、concepts、ontology 与 graph，通过 `remember / improve / recall` 组织记忆，并允许替换 LLM、embedding、vector store 和 graph database（[Cognee Docs](https://docs.cognee.ai/)）。它更像可编排的 knowledge-memory pipeline。

优点：开源、知识图谱导向、组件可替换，适合把企业知识与 Agent Memory 统一处理。

局限：体系较重；对用户偏好、session digest 和本地项目记忆不如 Mem0/Letta 直接。

判断：**适合作为知识/图谱型 provider，不适合作为默认轻量底座。**

### 4.6 Supermemory

Supermemory 把自己定位为 context infrastructure，覆盖 Memory、Retrieval、Profiles、Connectors、Extractors、Evals 和 observability。它使用 `containerTag` 隔离用户、项目或组织，提供自动 profile、graph memory、多模态输入、MCP、托管和自托管（[Supermemory Docs](https://supermemory.ai/docs/overview/what-is-supermemory)）。

优点：产品面完整，Memory 与 RAG、connector、多模态和团队知识统一，TypeScript 生态友好。

局限：平台边界较大；部分 benchmark 排名是自报；若直接作为底座会把 Downcity 的 Context 与 connector 体系交给外部平台定义。

判断：**适合需要托管 context platform 的用户作为可选 provider，不适合作为 Downcity 核心模型。**

### 4.7 MemOS 与 Memobase

MemOS 强调 memory production、recall、lifecycle management、跨任务 skill reuse，并同时提供 Cloud、开源、MCP 和 Agent framework 接入（[MemOS Docs](https://memos-docs.openmem.net/)）。它代表“Memory OS”路线，功能雄心较大，但项目年轻，Downcity 应先观察接口稳定性和真实基准。

Memobase 聚焦 user-profile long-term memory，内建中英文和日文 prompt，适合陪伴、客服和个性化 Agent（[Memobase Docs](https://docs.memobase.io/)）。它的范围比 Zep/Hindsight 小，但作用域清楚。

判断：**MemOS 适合作为观察对象；Memobase 可作为用户画像专用 provider。**

### 4.8 Hermes Agent 的 Provider 插件生态

Hermes Agent 不是一个单独的 Memory 数据库，而是一个把多种外部记忆后端接入 Agent 生命周期的插件宿主。其官方文档列出 8 个 provider：Honcho、OpenViking、Mem0、Hindsight、Holographic、RetainDB、ByteRover 和 Supermemory（[Memory Providers](https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/features/memory-providers)）。这份清单本身是一个重要市场信号：实际产品需要同时容纳云端 SaaS、自托管服务、本地 SQLite、CLI 知识树和用户建模系统，而不是假设一种存储形态适合所有人。

Hermes 的共性生命周期是：系统 prompt 注入 provider 上下文、每轮请求前预取、每轮响应后同步、会话结束提取、把内置 `MEMORY.md`/`USER.md` 镜像到外部 provider，并追加 provider 专属工具。它还要求每个 profile 独立存储路径和凭证，同一时间只激活一个外部 provider。其开发者协议进一步把 provider 抽象为 `is_available`、`initialize`、工具 schema/调用、`prefetch`、`sync_turn`、`on_session_end`、`on_pre_compress` 等方法，并明确 `sync_turn` 必须非阻塞（[Memory Provider Plugin Developer Guide](https://hermes-agent.nousresearch.com/docs/zh-Hans/developer-guide/memory-provider-plugin)）。

这些设计值得 Downcity 借鉴，但不应原样复制：

- **值得借鉴**：生命周期 hook、provider 能力声明、配置向导、profile 隔离、压缩前保存和单 provider 的运行时边界。
- **不应照搬**：把长期 Memory 与内置文件做双写镜像会产生两个事实来源；Downcity 的一个 Plugin 实例只能有一个主 Provider，文件或外部服务不能同时被当作 canonical owner。
- **对 Downcity 的启示**：SPI 应支持 `prefetch`、`ingest`/`sync_turn`、`on_session_end`、`on_pre_compress` 和工具暴露，但这些 hook 必须由宿主调度并带超时、异步和失败隔离策略；不能让外部 provider 阻塞 Agent 主链路。

Hermes 生态中的具体差异也很有代表性：Honcho 擅长辩证式用户建模，OpenViking 擅长文件系统层级和 L0/L1/L2 分层读取，Holographic 将 SQLite FTS5、信任评分、事实冲突与组合查询放在本地，ByteRover 采用本地优先知识树，RetainDB 提供向量 + BM25 + 重排序及多种记忆类型。这进一步支持 Downcity 的判断：存储、检索、提炼和上下文装配应是独立能力，而不是一个固定数据库接口。

### 4.9 EverOS、memU 与 Memori：可移植个人/Agent Memory

[EverOS](https://github.com/EverMind-AI/EverOS) 采用 Markdown canonical source + SQLite + LanceDB，本地保存 conversation、file 和 agent trajectory，并把 user episodes/profile 与 agent cases/skills 分开。它还提供 source-backed Wiki、离线 reflection 和按 user/agent/app/project/session 的正交 scope。其方向与 Downcity 当前 `sources/ + wiki/` 最接近，也是“人可编辑文件作为事实源”在市场上的强验证。局限是 Python server、LLM/embedding/reranker 配置较重，项目创建时间较晚，官方 benchmark 仍需独立复测。

[memU](https://github.com/NevaMind-AI/memU) 是跨 Codex、Claude Code、Cursor、OpenClaw、Hermes 等宿主的共享 LLM Wiki。它从宿主 session log 生成自包含任务，由 Agent 自己决定不处理、修订已有 Skill 或创建新 Skill；MemoryService 本身只保存、embedding 和检索 Markdown。它的“宿主 transcript adapter + Agent 自提炼 + 共享 Skill Markdown”很适合 coding-agent 经验复用，但依赖修改宿主 instruction 文件触发 retrieve，运行时契约不如 SDK hook 稳定。

[Memori](https://github.com/MemoriLabs/Memori) 强调从 Agent 做过的事而不仅是说过的话形成结构化状态，并提供 Python/TypeScript、Cloud、BYODB、VPC 与 on-premises 路径。它适合已有企业数据库、不希望替换数据基础设施的团队；但平台能力、开源 SDK 和托管增强功能需要分开评估。

判断：**EverOS 是 Downcity 文件式 Memory 的最直接竞品/参考；memU 是跨 coding-agent 记忆与 Skill 自演化的重要样本；Memori 是企业 BYODB 路线代表。**

### 4.10 TencentDB Agent Memory 与 RetainDB：团队和 Coding Memory Asset

[TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) 不把 Memory 限定为聊天事实，而是形成 Chat Memory、Skill、LLM-Wiki、CodeGraph 四类资产。它从 L0 Conversation 提炼为 L1 Atom、L2 Scenario、L3 Persona，并用 owner、version、status、private/team/restricted/agent ACL 和 Agent loadout 管理共享。这个方向非常接近“Agent 团队的经验资产控制面”，但项目创建于 2026 年，异步 Wiki/CodeGraph、自动路由和更广框架支持仍在演进；官方 PersonaMem 提升属于厂商自测。

[RetainDB](https://github.com/RetainDB/RetainDB) 已从简单云 API 演进为 Local 与 Server/Cloud 两条线。Local 使用快照 + append-only journal，支持 BM25/vector/graph、RRF、记忆强化、consolidation、handoff、context pack、delta context 和工具输出压缩；Server 增加 validFrom/validUntil、版本、关系和 connector。其 TypeScript 与 coding-agent 产品方向很适合 Downcity，但截至调研日仓库约 47 stars，Server 使用 BSL 1.1，成熟度和许可证都需要持续观察。

判断：**TencentDB Agent Memory 最值得借鉴团队资产、ACL 和 Agent loadout；RetainDB 最值得验证本地 coding memory 与 token-budget context router。两者都太年轻，不宜成为默认依赖。**

### 4.11 Memvid：单文件可移植 Memory Storage

[Memvid](https://github.com/memvid/memvid) 将数据、embedding、全文/向量/时间索引和 metadata 封装进一个 `.mv2` 文件。Smart Frame 是 append-only 不可变单元，支持 timeline、rewind、branch、WAL、Tantivy BM25、HNSW 和本地 ONNX embedding，并提供 Rust、Node.js、Python 和 CLI。

它解决的是**可移植、离线、单文件 Memory storage/index**，而不是完整的事实提取、用户画像、冲突治理和上下文策略。官方宣称的 LoCoMo 与低延迟结果需要在统一硬件和 harness 下复测。

判断：**Memvid 可作为 Downcity 可选的本地索引/归档格式研究对象，不能单独承担 Memory Engine。**

### 4.12 MIRIX、MemoryOS 与 Observational Memory：认知式分层路线

[MIRIX](https://github.com/Mirix-AI/MIRIX) 用多个专职 Agent 管理 Core、Episodic、Semantic、Procedural、Resource、Knowledge Vault 六类记忆，支持屏幕活动、多模态输入、本地长期数据、PostgreSQL BM25/vector 和 auto-dream consolidation。它借鉴 Letta，但更强调个人数字活动的连续观察。其完整 runtime 和视觉采集边界远大于 Downcity MemoryPlugin。

[BAI-LAB MemoryOS](https://github.com/BAI-LAB/MemoryOS) 采用 short-term、带 heat 的 mid-term segment、long-term persona/knowledge 三层晋升机制，是 EMNLP 2025 论文路线；[MemTensor MemOS](https://github.com/MemTensor/MemOS) 则是另一个独立项目，强调 Memory OS、hybrid retrieval 和跨任务 skill reuse。两者名称接近但不能混为一谈。

[Mastra Observational Memory](https://mastra.ai/docs/memory/observational-memory) 使用 Observer 和 Reflector 后台 Agent，把增长的原始 message/tool history 压缩成 dense observation log，并用 token threshold、异步 buffering、temporal marker、extractor 和 working-memory update 控制上下文。它主要解决长会话 context rot，与跨 session 事实数据库是相邻而非相同的问题。

判断：**Observation/Reflection 会成为 Memory Runtime 的标准能力，但必须保留被压缩原文或 evidence，否则高密度 observation 会变成不可审计的第二事实源。**

### 4.13 claude-mem：Coding Agent 会话观察与渐进式披露

[claude-mem](https://github.com/thedotmack/claude-mem) 通过 SessionStart、UserPromptSubmit、PostToolUse、Stop、SessionEnd 等宿主 hook 自动捕获工具使用和执行过程，生成 observation 与 semantic summary，并在未来 session 注入相关项目上下文。其本地 worker 使用 SQLite 保存 session/observation/summary，结合 FTS5 与 Chroma hybrid search，并通过 search → timeline → get_observations 的三层 MCP 工作流渐进读取。

它原本服务 Claude Code，现已扩展到 Codex、OpenClaw、Gemini、Hermes、Copilot、OpenCode 等宿主。截至调研日约 9 万 stars，Apache-2.0，是 coding-agent memory 中关注度最高的项目之一。

判断：**claude-mem 是“宿主生命周期 hook + 会话 observation + 渐进披露”的主流参考，但它主要记住 coding-agent 做过什么，不等同于通用用户画像、企业时态事实或团队知识治理。Downcity 应借鉴其 hook 和检索交互，不应复制其宿主专用安装与双存储边界。**

## 五、模型原生、Agent 框架与云厂商方案

### 5.1 Anthropic Memory Tool

Anthropic Memory Tool 让 Claude 调用 `view / create / str_replace / insert / delete / rename` 操作 `/memories` 下的文件；实际存储由客户端实现。官方明确建议按需读取以保持活动上下文聚焦，并要求宿主处理路径穿越、敏感信息、大小限制和过期（[Anthropic Memory Tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/memory-tool)）。

这与 Downcity 当前 `wiki/ + sources/` 最接近。它证明文件不是落后方案，而是一种模型可以直接理解、用户可以审阅、宿主可以自行存储的稳定协议。但 Anthropic Memory Tool 不负责自动事实抽取、混合检索、冲突处理和多租户治理。

判断：**Downcity 应兼容这种按文件读取/修订的心智模型，同时在其下增加 provider-neutral 索引与证据治理。**

### 5.2 OpenAI Agents SDK Sessions

OpenAI Agents SDK 的 Sessions 自动在每次 run 前加载同一 session 的历史，在 run 后保存新消息与工具调用；内建 SQLiteSession，并允许自定义 history merge、限制获取条数或使用服务端 conversation continuation（[OpenAI Sessions](https://openai.github.io/openai-agents-python/sessions/)）。

这是 conversation persistence，不是完整长期 Memory。它不自动形成跨 session 用户画像、事件、程序性知识或时态事实。

判断：**Downcity Session 已拥有该职责，不应让 MemoryPlugin 重复接管 checkpoint 和消息历史。**

### 5.3 LangGraph / LangMem

LangGraph 清楚地区分 thread-scoped short-term memory（checkpointer）与 namespace-scoped long-term store，并支持 SQLite、Postgres、Redis 等持久化。LangMem 在其上提供事实/画像提炼、episodic example 与 procedural prompt adaptation，并区分 hot path 和后台记忆形成（[LangGraph Memory](https://docs.langchain.com/oss/python/langgraph/add-memory)、[LangMem](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)）。

判断：**它是 Memory SPI 和作用域设计的重要参考，但 LangGraph runtime 不应成为 TypeScript Downcity 内核依赖。**

### 5.4 LlamaIndex

LlamaIndex 新 `Memory` 组合短期 FIFO 与长期 Memory Blocks；预置 Static、FactExtraction 和 Vector blocks，并用 priority 与 token budget 控制哪些内容进入 system 或最新 user message。它也明确区分 workflow context 与 memory（[LlamaIndex Memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)）。

判断：**Memory Block + token budget + priority 值得借鉴，框架本身不适合作为 Downcity 基础依赖。**

### 5.5 CrewAI

CrewAI 现有 unified `Memory` 会在保存时推断 scope、category 和 importance，在召回时组合 similarity、recency 和 importance，并支持层级 scope、跨 scope slice、consolidation、异步写入与 source/private 标记。默认存储为 LanceDB，也可实现 StorageBackend（[CrewAI Memory](https://docs.crewai.com/en/concepts/memory)）。

判断：**它在 scope、复合评分、后台写入和 read barrier 上提供了很好的工程参考；但其 Memory 与 Crew/Agent/Flow 生命周期绑定，不应直接成为 Downcity provider。**

### 5.6 AutoGen / AG2

AutoGen AgentChat 定义 `Memory` protocol，核心方法是 `add / query / update_context / clear / close`，并提供简单 ListMemory 和外部 memory integration（[AutoGen Memory](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/memory.html)）。

判断：**协议足够简洁，但缺少事实生命周期和证据层；适合作为最小 SPI 的下界参考。**

### 5.7 Mastra、Google ADK 与 Semantic Kernel

Mastra 是当前最值得 Downcity关注的 TypeScript 框架参考。除 conversation history 和 working memory 外，其 Observational Memory 把旧消息/工具结果后台压缩为 observations，再通过 Reflector 重组；支持 pg、libSQL、MySQL、MongoDB、Convex、Oracle 等 adapter。优点是 context budget、prompt cache 和异步 buffering 设计完整；局限是观察日志仍是模型派生摘要，且与 Mastra Agent/Storage 生命周期耦合。

Google ADK 区分 Session/State 与长期 MemoryService，支持把完成的 session 加入 memory 后再通过搜索召回；这是清楚的 runtime boundary，但不等于自动事实治理。Microsoft Semantic Kernel 当前主要提供 Vector Store 与 RAG 抽象，官方也明确它是低层 add/retrieve API，不能当作完整长期 Memory Engine。

判断：**Mastra 是 TypeScript context runtime 的重要参考；Google ADK 和 Semantic Kernel 分别代表 session-to-memory 接口与底层 vector abstraction，均不应反向定义 Downcity canonical memory。**

### 5.8 AWS AgentCore Memory 与 Google Memory Bank

AWS AgentCore Memory 是托管服务，区分单 session 的 short-term events 与跨 session 自动抽取的 long-term preferences、facts 和 summaries，并支持多 Agent 和工作流场景（[AWS AgentCore Memory](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html)）。Google Vertex AI Agent Engine Memory Bank 也提供托管的记忆生成和检索，并与 Google Agent Runtime/ADK 集成（[Google Memory Bank](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview)）。

判断：**两者适合已经绑定对应云的部署适配器，不应进入 Downcity 公共协议。云厂商解决托管与合规，不应反向定义 Agent Memory 的领域模型。**

## 六、横向比较

评分为针对 Downcity 底座的工程判断，5 为强、1 为弱；并非产品绝对排名。

| 方案 | 可追溯 | 时态/冲突 | 混合检索 | 人可编辑 | 本地部署 | TS 接入 | 适合位置 |
|---|---:|---:|---:|---:|---:|---:|---|
| Downcity LLM Wiki（重构前） | 5 | 2 | 1 | 5 | 5 | 5 | 文件式实现参考 |
| Mem0 | 3 | 3 | 4 | 3 | 4 | 5 | 通用托管/事实 provider |
| Zep | 5 | 5 | 5 | 2 | 2 | 5 | 企业托管时态图 provider |
| Graphiti | 5 | 5 | 5 | 2 | 4 | 2 | 高级开源图 provider |
| Letta | 4 | 3 | 4 | 4 | 4 | 5 | 完整 stateful-agent runtime |
| Hindsight | 5 | 5 | 5 | 4 | 5 | 5 | 高级学习型 memory provider |
| Cognee | 4 | 4 | 5 | 2 | 4 | 2 | 知识图谱 pipeline |
| Supermemory | 4 | 4 | 5 | 4 | 4 | 5 | 托管 context platform |
| MemOS | 4 | 4 | 5 | 3 | 4 | 4 | 新兴 Memory OS provider |
| Memobase | 3 | 3 | 4 | 4 | 4 | 4 | 用户画像 provider |
| OpenViking | 4 | 3 | 4 | 4 | 5 | 2 | 自托管分层知识 provider |
| Honcho | 4 | 4 | 4 | 3 | 4 | 2 | 用户-Agent 建模 provider |
| Holographic | 4 | 4 | 4 | 3 | 5 | 2 | 本地 SQLite 事实 provider |
| ByteRover | 3 | 3 | 4 | 4 | 5 | 3 | 本地优先知识树 provider |
| EverOS | 5 | 4 | 5 | 5 | 5 | 2 | Markdown canonical memory / Wiki |
| memU | 4 | 3 | 4 | 5 | 5 | 3 | 跨 coding-agent Wiki/Skill memory |
| Memori | 4 | 4 | 4 | 3 | 5 | 5 | 企业 BYODB memory infrastructure |
| TencentDB Agent Memory | 5 | 4 | 5 | 5 | 5 | 5 | 团队 Memory Asset 控制面 |
| RetainDB | 5 | 5 | 5 | 4 | 5 | 5 | 本地 coding memory/context router |
| Memvid | 5 | 4 | 4 | 2 | 5 | 5 | 单文件 storage/index，不是完整 Engine |
| MIRIX | 4 | 4 | 5 | 3 | 5 | 2 | 多模态个人 memory runtime |
| BAI MemoryOS | 3 | 3 | 4 | 2 | 5 | 2 | 研究型分层 persona memory |
| Mastra Observational Memory | 4 | 3 | 4 | 3 | 5 | 5 | 长会话 observation/context runtime |
| claude-mem | 4 | 3 | 5 | 3 | 5 | 5 | Coding session observation memory |
| Hermes Provider SPI | 取决于后端 | 取决于后端 | 取决于后端 | 4 | 5 | 2 | Agent 生命周期集成参考 |
| Anthropic Memory Tool | 5 | 2 | 1 | 5 | 5 | 5 | 模型原生文件协议 |
| OpenAI Sessions | 5 | 1 | 1 | 2 | 5 | 2 | session history，不是长期记忆 |
| LangGraph/LangMem | 4 | 3 | 4 | 3 | 5 | 2 | 框架参考与 Python provider |
| AWS AgentCore Memory | 4 | 4 | 4 | 2 | 1 | 4 | AWS 托管 provider |
| Google Memory Bank | 4 | 4 | 4 | 2 | 1 | 4 | GCP 托管 provider |

开源生态快照也说明市场已经形成多个强势路线，而非一家公司胜出：截至 2026-08-11，claude-mem 约 9 万 stars，Mem0 约 6.3 万；Cognee/Graphiti/Supermemory/Mastra/OpenViking 约 2.7–3 万；Letta 约 2.4 万；Hindsight 与 TencentDB Agent Memory 约 2 万；Memvid/Memori/memU 约 1.4–1.6 万；EverOS/MemOS 约 1.1–1.2 万。RetainDB 只有约 47 stars，Holographic 没有独立仓库。Stars 只反映关注和生态，不等于生产稳定性或准确率；对应数据来自各项目 GitHub API 快照。

## 七、评测证据与不能轻信的指标

### 7.1 两个重要公开 benchmark

**LoCoMo** 包含最长 35 个 session、约 300 turns 的长程对话，评测问答、事件总结和多模态对话。论文结论是 long-context 和 RAG 虽有帮助，但仍明显落后于人类，尤其难处理时态和因果关系（[LoCoMo](https://arxiv.org/abs/2402.17753)）。

**LongMemEval** 用 500 个问题评测 information extraction、multi-session reasoning、temporal reasoning、knowledge update 和 abstention，并把系统拆成 indexing、retrieval、reading 三阶段。论文报告持续交互会使商业助手与长上下文模型的准确率下降约 30%，并提出 session decomposition、fact-augmented keys 和 time-aware query expansion（[LongMemEval](https://arxiv.org/abs/2410.10813)）。

这两套 benchmark 证明：

- 保存完整聊天记录不等于记忆。
- 单纯扩大 context window 不解决更新、冲突和检索噪声。
- 只使用向量相似度不足以处理人名、精确术语、时间和多跳关系。
- 系统必须能在证据不足时 abstain，而不是强行利用模糊记忆回答。

### 7.2 厂商分数的可比性问题

Mem0、Zep、Hindsight、Supermemory 都公开了较高 benchmark 结果，但测试经常存在以下差异：

- 使用不同生成模型、embedding、reranker 和 judge。
- 给模型的最终 token budget 不同。
- 是否允许额外 reflect/agentic retrieval 调用不同。
- latency 是否包含异步 ingestion、embedding 和图构建不同。
- 数据集版本、问题过滤和失败重试策略不同。

因此 Downcity 不应按宣传页排名选底座，而应建立统一 harness，在同一模型、同一预算、同一数据隔离规则下复测。

## 八、Downcity 当前 MemoryPlugin 评估

当前实现具有这些优势：

1. **证据和知识分层有价值**：`sources/` 保存原始输入，`wiki/` 保存整理后的知识，天然支持重建和人工审计。
2. **人可读、可编辑、可迁移**：Markdown 不依赖数据库工具，适合代码项目与本地 Agent。
3. **模型中立**：`digest` 和 `revise` 通过 constructor callback 注入，不锁定 LLM。
4. **失败时仍可工作**：没有模型时使用确定性落盘与追加，不会让 Memory 完全不可用。
5. **引用可解释**：搜索结果返回文件、行号和 citation，比只返回向量记录更容易验证。

主要缺口：

1. **搜索只做 Markdown token scan**：中文分词、同义词、实体、精确词和语义召回能力有限。
2. **没有稳定 Memory SPI**：重构前的存储、索引、提炼和检索都直接依赖文件实现，第三方 Memory 服务无法自然接入。
3. **没有 scope 模型**：缺少 user、agent、workspace、project、organization、shared/private 等明确作用域。Hermes 的 profile 隔离说明，这项能力必须同时覆盖数据路径、凭证和 provider 配置，不能只做查询标签。
4. **没有时态事实**：无法表达 valid_from、valid_to、observed_at、supersedes，事实更新依赖整页 LLM revise。
5. **没有结构化记忆类型**：事实、偏好、事件、经验、规则和画像都落入自由 Markdown。
6. **没有自动 ingestion policy**：什么时候记忆、哪些工具结果值得记、是否后台提炼仍依赖显式 action。
7. **没有遗忘和治理**：缺少 TTL、删除传播、敏感信息策略、来源权限、容量预算和审计事件。
8. **没有 memory eval harness**：无法量化 recall、precision、temporal correctness、citation correctness 和 token cost。

关键判断：**Downcity 需要把 LLM Wiki 下沉为 Builtin Provider 的默认投影，而不是让它继续定义 MemoryPlugin。Evidence、Projection 和 citation 是领域概念；JSONL、Markdown 和 SQLite 是可替换实现。**

## 九、推荐的 MemoryPlugin 底座

### 9.1 领域边界

`MemoryPlugin` 应负责：

- 暴露稳定 Action 与 system context 入口。
- 把 Agent、Workspace 和 Session 调用上下文映射为领域 scope。
- 管理唯一 `MemoryProvider` 的生命周期。

`MemoryProvider` 应负责：

- 接受需要长期保留的 evidence。
- 把 evidence 提炼为不同类型的 memory projection。
- 按 scope、时间、来源和权限进行检索。
- 在上下文预算内组装可引用的 memory context。
- 支持纠错、失效、删除、重建与审计。

它不应该负责：

- 保存完整 Session checkpoint；这是 Agent/Session Storage 的职责。
- 固定绑定向量库、图数据库或某个 LLM。
- 把所有聊天和工具输出无差别写入长期记忆。
- 自动将高风险推断升级为用户事实。
- 让 provider 返回不可审计的 prompt 字符串作为唯一结果。

### 9.2 建议的最小 SPI

```ts
interface MemoryProvider {
  readonly name: string;
  readonly capabilities: MemoryProviderCapabilities;

  initialize(input: MemoryProviderInitializeInput): Promise<void>;
  status(): Promise<MemoryStatusResult>;
  remember(input: MemoryRememberInput): Promise<MemoryRememberResult>;
  recall(input: MemoryRecallInput): Promise<MemoryRecallResult>;
  read(input: MemoryReadInput): Promise<MemoryReadResult>;
  digest(input: MemoryDigestInput): Promise<MemoryDigestResult>;
  revise(input: MemoryReviseInput): Promise<MemoryReviseResult>;
  forget(input: MemoryForgetInput): Promise<MemoryForgetResult>;
  system_context(input: MemorySystemContextInput): Promise<MemorySystemContextResult>;
  dispose(): Promise<void>;
}
```

公开结果至少应包含：

```text
memory_id
memory_type
scope
content
score
valid_from / valid_to
observed_at
source_evidence_ids
citation
confidence
warnings
```

一个 `MemoryPlugin` 实例只绑定一个主 Provider，避免同时写入多个后端后出现多个事实源。需要组合 BM25、vector、graph 或多个远程服务时，应由一个显式 `CompositeMemoryProvider` 统一拥有一致性、融合和失败语义，而不是让 Plugin 自己双写。

存储、索引和文件能力继续存在，但只作为某个 Provider 的内部 Adapter。例如：

```ts
interface MemoryStorageAdapter {
  initialize(): Promise<void>;
  read(key: string): Promise<string | null>;
  write(key: string, content: string): Promise<void>;
  list(prefix: string): Promise<MemoryStorageEntry[]>;
  delete(key: string): Promise<void>;
  dispose(): Promise<void>;
}
```

`FileMemoryStorageAdapter`、SQLite、对象存储和远程 KV 都可以实现这层协议，但它们不能直接成为 MemoryPlugin 的领域 API，也不能向 Agent 暴露物理路径。

外部 Provider 实现还可以在内部实现生命周期 hook：

```text
initialize → prefetch → sync_turn → on_pre_compress → on_session_end → shutdown
```

Hermes 已在 8 种 provider 上验证了这类 hook 的实用性。Downcity 需要额外约束每个 hook 的超时、并发、幂等性、失败降级和可观测性；`sync_turn`、提炼和外部写入默认不得阻塞 Agent 响应。

### 9.3 默认实现

推荐默认本地组合：

```text
MemoryPlugin
  → BuiltinMemoryProvider
     → FileMemoryStorageAdapter（当前默认持久化）
     → SQLite FTS/BM25 Adapter（后续可选索引）
     → Embedding Adapter（后续可选语义索引）
     → deterministic context budgeter
```

Builtin Provider 可以继续组织 evidence 与 Wiki 投影，但这些结构只属于它自己的实现。接入 Mem0、Hindsight 或 Graphiti 时，对应 Provider 直接把各自的数据模型转换成统一 `MemoryRecord`、`memory_id`、scope 和 citation，不需要模拟文件目录。

为什么不默认上向量数据库：

- 小到中型本地 memory 用 SQLite FTS 已能覆盖精确词、BM25、过滤和排序。
- embedding 应是可选索引，删除后可以从 evidence 重建。
- 数据的 canonical form 不应依赖 embedding model 和维度。
- 向量召回不解决时态、冲突、权限与 citation。

为什么仍保留 Wiki：

- Agent 和用户都能直接检查与修订。
- Git 和文件备份天然可用。
- Anthropic Memory Tool 已验证模型对文件式长期记忆的原生适配。
- 项目决策、用户偏好和工作状态经常更适合少量连贯页面，而不是大量原子向量记录。

## 十、推荐适配器优先级

### 第一优先级：协议化现有实现

- `MemoryProvider`
- `BuiltinMemoryProvider`
- `MemoryStorageAdapter`
- `FileMemoryStorageAdapter`

目标是先把 ownership、scope、provenance 和 lifecycle 设计正确。文件只保留为默认 Adapter，不能再进入 MemoryPlugin 的公开 Action 和结果协议。

### 第二优先级：Mem0 Provider

映射建议：

- Downcity scope → Mem0 `user_id / agent_id / app_id / run_id`
- `remember` → Mem0 `add`
- `search` → Mem0 search
- history/expiration → provider capability
- evidence 与 provenance 由 Mem0 Provider 自己拥有或映射，Plugin 不做额外双写

用途：快速验证个性化 Agent、用户偏好和托管 Memory。

### 第三优先级：Hindsight 或 Graphiti Provider

Hindsight 更适合“Agent 从经验学习”的完整路径；Graphiti 更适合“业务事实随时间变化”的路径。

不要同时把两者做成硬依赖。先用统一 benchmark 决定：

- 如果 episodic learning、reflection、混合搜索表现更重要，优先 Hindsight。
- 如果 provenance、validity window、企业实体关系更重要，优先 Graphiti/Zep。

### 第四优先级：云托管 Provider

AWS AgentCore Memory、Google Memory Bank、Zep Cloud、Mem0 Platform、Supermemory 都应放在相同 provider 边界后面，由部署环境决定。

## 十一、建议的路由策略

```text
1. 当前 turn / workflow state
   → Session / Checkpoint，不进入长期 Memory

2. 明确用户偏好、身份、长期目标
   → Semantic Profile / Fact

3. 项目决策、规范、长期工作状态
   → Wiki Projection + citation

4. 成功/失败执行轨迹、用户反馈
   → Episodic Memory，经过提炼后再保存

5. 行为规则、稳定工作方法
   → Procedural Memory，必须版本化并可审批

6. 会变化的业务事实与实体关系
   → Temporal/Graph Provider

7. 召回
   → scope filter → BM25/vector/graph/temporal 并行 → fusion/rerank
   → context budget → 带引用注入
```

默认不要在每轮对话后同步运行昂贵 LLM digest。采用两条写入路径：

- **Hot path**：用户明确说“记住”、关键决策产生、Agent 显式调用 `remember` 时同步保存 evidence。
- **Background path**：Session 结束、达到消息阈值或宿主调度时异步 digest/consolidate；通过 read barrier 或 projection version 保证一致性。

## 十二、安全、隐私和治理

Agent Memory 会把一次性的错误、恶意 prompt injection 或敏感信息变成长期影响，因此风险高于普通 RAG。

必须设计：

- **Scope isolation**：user、agent、workspace、organization 之间默认隔离。
- **Provenance**：每条派生记忆能追溯到 message、tool result、manual input 或 external record。
- **Confidence**：区分用户明确陈述、外部事实、Agent 推断和模型总结。
- **Write policy**：确保不把网页内容和第三方文本直接升级为用户偏好或 procedural rule。
- **Deletion propagation**：删除 evidence 后能够使相关 projection 和 index 失效或重建。
- **Temporal validity**：保留旧事实历史，但默认只注入当前有效事实。
- **Sensitive data filter**：密钥、健康、支付、身份和私密信息需要显式策略。
- **User inspection**：用户能搜索、查看、修订、导出和删除自己的 Memory。
- **Prompt injection defense**：Memory 内容作为不可信数据注入，不获得 system instruction 权限。

Anthropic 官方 Memory Tool 同样强调路径穿越、敏感信息、文件大小和过期控制，说明这些不是外围功能，而是 Memory API 的基础职责。

## 十三、Downcity 专用基准测试

在选择 Hindsight、Graphiti、Mem0 或自研检索之前，建议建立统一 benchmark：

1. **准确记忆**：用户明确偏好能否在 10、100、1000 条干扰后召回。
2. **知识更新**：先说“使用 SQLite”，后来改成“使用 Postgres”，是否只返回当前决策并保留历史引用。
3. **时态问题**：回答“上个月采用的方案是什么”“什么时候发生变更”。
4. **多跳关系**：跨项目、人员、工具和决策组合回答。
5. **经验学习**：过去失败的部署步骤能否影响新任务，但不把偶然失败写成永久规则。
6. **Abstention**：没有证据时是否明确说不知道。
7. **删除与隔离**：删除用户数据后是否从索引、profile、graph 和 cache 全部消失；不同 scope 是否串数据。
8. **Citation correctness**：结果引用是否确实支持记忆内容。
9. **成本与延迟**：ingestion、recall、reflect 的 P50/P95、LLM calls、embedding calls 和 token 数。
10. **恢复能力**：索引全部删除后能否只根据 evidence 重建。

建议先移植 LongMemEval 的五类能力，再加入 Downcity 项目决策、Tool Result、Skill 学习和多 Agent shared memory 场景。

## 十四、实施顺序

### Phase 1：重构边界

- 明确 Session Storage 与 Long-term Memory 边界。
- 定义 evidence、projection、index、retrieval、context assembly 类型。
- 引入 scope、provenance、confidence、validity 和 memory type。
- 保持现有 actions 可用，但内部改走 provider-neutral runtime。

### Phase 2：增强默认本地实现

- SQLite 保存元数据、版本、关系和 FTS5 索引。
- Wiki 继续作为 human projection。
- 增加 profile、fact、episode、procedure 四类结构化 projection。
- 增加后台 digest、consolidation、失效与重建。
- 增加统一 context budget 和 citation 注入。

### Phase 3：Provider 验证

- 接入 Mem0 Provider 验证通用事实/画像场景。
- 在 Hindsight 与 Graphiti 中选择一个高级开源 Provider。
- 用 EverOS 对照 Markdown canonical + Wiki，用 RetainDB Local 对照 coding memory/context pack，用 Memvid 对照单文件可移植索引。
- 参考 Mastra Observational Memory 验证后台 observation buffering，但不允许 observation 替代 evidence。
- 对 AWS、Google、Zep Cloud、Supermemory 保持部署型可选适配。

### Phase 4：Evals 与治理

- 建立 LongMemEval/LoCoMo 子集和 Downcity 专用数据集。
- 为自动 Memory 写入增加 policy、审批、PII 过滤和删除传播测试。
- 用指标决定是否默认开启 vector、graph 或 reflect，而不是凭产品宣传决定。

## 十五、最终选择

### 如果只能选择一个 Downcity 底座

选择：

> **Downcity 自有的 provider-neutral MemoryPlugin + 单一 MemoryProvider SPI；Builtin Provider 默认组合本地 Storage 与可替换索引 Adapter。**

它不是市场上功能最多的单体产品，却最符合 Downcity 的所有权边界：Plugin 不理解文件和环境，Provider 是唯一事实源，Adapter 可以替换，外部 Memory Engine 也能直接映射到同一领域协议。

### 如果只能接一个外部产品

选择 **Mem0** 做第一通用适配器。理由是生态、TypeScript、托管/自部署和简单 API 最均衡。

### 如果追求高级 Memory 能力

优先基准测试 **Hindsight**，同时以 **Graphiti** 作为时态知识图谱对照。Hindsight 的整体协议更接近完整 Memory Engine；Graphiti 在双时态事实、provenance 和企业关系数据上更强。

### 如果聚焦本地 Coding Agent

优先研究 **EverOS + RetainDB Local + memU**：EverOS 验证 Markdown canonical memory，RetainDB 验证 TypeScript 本地检索和 context router，memU 验证跨宿主 transcript 与 Skill 自演化。三者都应作为设计对照或 Provider 实现，而不是反向定义 MemoryPlugin。

### 不建议的选择

- 不把 Pinecone/Qdrant/Chroma 直接叫作 Memory 底座；它们是索引。
- 不把 Letta 直接嵌入 Downcity Agent runtime；所有权重叠。
- 不把 AWS/Google Memory 设为默认；云锁定。
- 不用一段自动总结覆盖原始历史；摘要只能是可重建 projection。
- 不让 Agent 无审批地修改长期 procedural memory 或共享组织规则。

## 十六、来源索引

### 产品与官方文档

- [Mem0 OSS Overview](https://docs.mem0.ai/open-source/overview)
- [Mem0 Memory Operations](https://docs.mem0.ai/core-concepts/memory-operations)
- [Zep Documentation](https://help.getzep.com/)
- [Graphiti GitHub](https://github.com/getzep/graphiti)
- [Letta Memory Blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks/)
- [Hindsight Documentation](https://hindsight.vectorize.io/)
- [Hindsight GitHub](https://github.com/vectorize-io/hindsight)
- [Cognee Documentation](https://docs.cognee.ai/)
- [Supermemory Documentation](https://supermemory.ai/docs/overview/what-is-supermemory)
- [MemOS Documentation](https://memos-docs.openmem.net/)
- [Memobase Documentation](https://docs.memobase.io/)
- [Honcho GitHub](https://github.com/plastic-labs/honcho)
- [OpenViking GitHub](https://github.com/volcengine/OpenViking)
- [EverOS GitHub](https://github.com/EverMind-AI/EverOS)
- [memU GitHub](https://github.com/NevaMind-AI/memU)
- [Memori GitHub](https://github.com/MemoriLabs/Memori)
- [TencentDB Agent Memory GitHub](https://github.com/TencentCloud/TencentDB-Agent-Memory)
- [RetainDB GitHub](https://github.com/RetainDB/RetainDB)
- [ByteRover CLI GitHub](https://github.com/campfirein/byterover-cli)
- [Memvid GitHub](https://github.com/memvid/memvid)
- [MIRIX GitHub](https://github.com/Mirix-AI/MIRIX)
- [BAI-LAB MemoryOS GitHub](https://github.com/BAI-LAB/MemoryOS)
- [claude-mem GitHub](https://github.com/thedotmack/claude-mem) · [Docs](https://docs.claude-mem.ai/)
- [Hermes Agent Memory Providers](https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/features/memory-providers)
- [Hermes Agent Memory Provider Plugin Developer Guide](https://hermes-agent.nousresearch.com/docs/zh-Hans/developer-guide/memory-provider-plugin)
- [Anthropic Memory Tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/memory-tool)
- [OpenAI Agents SDK Sessions](https://openai.github.io/openai-agents-python/sessions/)
- [LangGraph Memory](https://docs.langchain.com/oss/python/langgraph/add-memory)
- [LangMem Conceptual Guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- [LlamaIndex Memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)
- [CrewAI Memory](https://docs.crewai.com/en/concepts/memory)
- [AutoGen Memory](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/memory.html)
- [Mastra Observational Memory](https://mastra.ai/docs/memory/observational-memory)
- [Google ADK Sessions and Memory](https://google.github.io/adk-docs/sessions/memory/)
- [Semantic Kernel Vector Store](https://learn.microsoft.com/en-us/semantic-kernel/concepts/vector-store-connectors/)
- [AWS Bedrock AgentCore Memory](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html)
- [Google Vertex AI Memory Bank](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview)

### 论文与 Benchmark

- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413)
- [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956)
- [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110)
- [Memory OS of AI Agent](https://arxiv.org/abs/2506.06326)
- [MIRIX: Multi-Agent Memory System](https://arxiv.org/abs/2507.07957)
- [LongMemEval](https://arxiv.org/abs/2410.10813)
- [LoCoMo](https://arxiv.org/abs/2402.17753)

## 十七、研究限制与质量说明

- 主要证据来自官方文档、官方仓库和论文；产品定价、企业 SLA 与区域可用性未做采购级核验。
- GitHub stars 只用于衡量社区关注，不用于判断准确率。
- 多数 benchmark 结果缺乏统一独立复现，报告没有据此给出绝对排名。
- Google、AWS 等托管服务迭代快，正式适配前需要按部署区域重新确认 API 和计费。
- 本报告质量评分为 4.6/5：架构与产品覆盖较完整，主要不确定性来自 2026 年新兴方案的生产历史与 benchmark 可比性。

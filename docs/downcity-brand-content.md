# Downcity Brand Content

**Document version:** v3
**Last updated:** 2026-10-10
**状态：** 主品类与优先人群保持不变；核心价值已调整为扩大 Builder 构建、运营 Agent 应用体系的能力。本文旧 Hero、Tagline 与价值段仅供历史参考，不是当前定稿。最新价值定义见 [Downcity 对 Builder 的核心价值](downcity-builder-value.md)。仅文档，不替换线上内容。

## 1. 定义与资料边界

Brand content 不是关键词包装或首页 slogan 集合，而是对「我们相信什么、为谁创造什么价值、为什么值得信任、如何一致地表达」的共同定义。它先约束产品叙事，再指导首页、README、文档、发布与 SEO 内容。

本稿依据：
- Genesis Cosmos 官网 https://genesiscosmos.com/ （本次读取的公开使命与观点）。
- 本仓库 README.md / README.zh-CN.md。
- private/apps/homepage/app/lib/homepage-positioning.ts 与首页结构。

下文明确区分公开原文、产品资料与建议表达。愿景不是已交付能力；拟定人群与购买动机不是已验证客户研究。没有虚构客户、增长数字或市场领先结论。

## 2. 从 Genesis Cosmos 到 Downcity

### Genesis Cosmos：为什么要做

官网原文：

> Building the open creation economy for the agent era.

> Help agent-native creators turn intent into living systems, and living systems into economies they own.

中文公开表达：构建 Agent 时代的开放创作者经济；帮助 AI 原生创作者把意图转化为可运行系统，并把这些系统转化为他们拥有的经济。

核心判断：**创作正在变得可运行。** 创作者不只发布内容，也会发布能够记忆、执行、回应与演化的世界、工作流、Agent、产品和服务。生成能力之外，还需要运行、授权、用量与市场基础设施。

### Downcity：具体承担什么

基于 README 的产品定位：为持续交付多个 Agent 产品与工作流的 AI builders 提供可复用的 Agent 基础设施，而不是每做一个产品就重建运行后端。

建议品牌关系：

| 层次 | 角色 | 表达 |
|---|---|---|
| Genesis Cosmos | 公司愿景与研究母体 | 让创作者把意图变成可运行系统，并保有对其经济的所有权 |
| Downcity | Agent 运行与产品化的基础设施品牌 | 让 Agent 从一次演示走向可持续运行的产品 |
| Agent / City / Federation / UI | 实现路径 | 执行运行时、产品组合边界、共享服务与用户界面 |

Downcity 服务于母品牌愿景，但不等于 Genesis Cosmos 的全部愿景。不要把所有世界引擎、市场、结算与创作者经济目标都宣称为 Downcity 当前已完成的产品。

## 3. 品牌核心

### 品牌信念

**有价值的 AI 创作，不应止步于一次生成；它应成为人能够掌控、持续运行并不断发展的系统。**

### 品牌使命（建议）

让构建者不必重复搭建 Agent 基础设施，就能把自己的想法交付为可运行、可运营的产品。

### 品牌承诺（建议）

**把运行 Agent 的复杂性沉淀为基础设施，把创造产品的空间留给构建者。**

这是一项方向性承诺，不代表零配置、零运维或无限扩展。

### 一句话定位（建议主版本）

中文：**Downcity 是开源 Agent 基础设施，帮助独立开发者和小型团队把 Agent 构建成持续运行的产品。**

English: **Downcity is open-source agent infrastructure for builders turning agents into products that keep running.**

技术补充：Agent Harness 提供执行运行时，City、Federation、SDK 与 UI 组合产品边界、共享服务和交互界面。

### 叙事顺序

1. 用户成果：把 Agent 做成真实产品。
2. 痛点：不要为每个产品重复搭建运行、状态、工具和共享服务。
3. 品类：open-source agent infrastructure / agent harness。
4. 实现：Agent、City、Federation、SDK、UI。
5. 远景：让更多创作者拥有能够持续创造价值的系统。

不要让新用户先记住一套世界观术语，才能知道产品有什么用。

## 4. 目标人群与边界

已确认的优先人群：独立 AI builder 与小型 AI 产品团队。AI 原生创作者是长期受众方向，不将其直接等同于当前全部目标用户。具体购买动机仍需客户研究验证。

他们希望：
- 从能调用模型的 demo，走向能够保留上下文、执行任务与持续运行的产品。
- 在不同 Agent 与产品之间复用基础能力。
- 保留对工作空间、工具、权限与用户交互的控制。

不宜作为当前主要承诺：面向所有人的零代码建站、完全无需监督的自主公司、一键自动盈利、替代全部现有系统。大型企业的合规与 SLA 采购需求也不能在没有证据时默认满足。

## 5. 信息支柱与证据责任

| 支柱 | 用户价值 | 资料支撑 | 对外表达边界 |
|---|---|---|---|
| 持续运行 | 工作不止于一次对话 | Agent runtime、Session、任务、记忆等实现与文档 | 不承诺永不失败或无限上下文 |
| 可复用基础设施 | 每个新产品少重复一层基础建设 | README 包划分、City、Federation、服务与 SDK | 无基准数据时不说节省 X% 成本 |
| 人的控制 | 工具执行有边界，工作可检查 | Workspace、权限、状态、历史、控制界面 | 不把开源等同于绝对安全 |
| 产品化交付 | Agent 有运行边界和用户界面 | City、Federation、UI SDK、CLI | 不把 demo 等同于成熟商业运营 |
| 开放与所有权方向 | 让构建者保有选择和扩展空间 | Apache 2.0 开源与明确扩展接口 | 数据迁移、支付结算与用户所有权须按具体实现说明 |

## 6. 品牌文案库（候选，未批准上线）

### 主张 / Tagline

首选：
- **让 Agent 成为持续运行的产品。**
- **Turn agents into products that keep running.**

技术辅助句：
- **开源 Agent 运行时与产品化基础设施。**
- **Open-source agent runtime and product infrastructure.**

远景型表达：
- **为你的 Agent，构建可以持续工作的世界。**
- **Build worlds where agents live, work, and collaborate.**（沿用现有表达作为远景，不单独承担产品解释。）

### Homepage Hero 候选

Eyebrow: Open-source agent infrastructure

标题：让 Agent 成为持续运行的产品。

描述：运行 Agent，保留工作上下文，连接工具与服务。Downcity 提供可复用的运行时和产品基础设施，让你专注于产品，而不是为每个新想法重建后端。

English headline: Turn agents into products that keep running.

English description: Run agents, retain context, and connect tools and services. Downcity provides a reusable runtime and product infrastructure so you can focus on your product—not rebuild the backend for every new idea.

CTA：开始构建 / 查看示例。具体按钮名称与目的地以后验证，不在本阶段修改。

### 短品牌介绍

Downcity 是 Genesis Cosmos 构建的开源 Agent 基础设施，面向独立开发者和小型 AI 产品团队。它将 Agent 运行时、工作空间、工具与共享服务组合在一起，让你从一个 Agent 开始，逐步构建用户可以使用、团队可以运营的产品。

### English short description

Downcity is open-source agent infrastructure by Genesis Cosmos, built for independent developers and small AI product teams. It brings together agent execution, workspaces, tools, and shared services. Start with an agent, then build a product people can use and your team can operate.

### 品牌故事

创作曾经意味着把想法变成一段文字、一张图像或一段视频。现在，它也可以意味着一个会记住上下文、调用工具、执行任务并回应用户的系统。

但让 Agent 跑通一次，与让产品持续运行，是两件不同的事。构建者需要组织状态、权限、工作空间、服务与界面；如果每个项目都从零拼接，创造的注意力就会被基础设施消耗。

Downcity 希望把这层重复工作沉淀下来。Agent 拥有执行工作的运行时，City 组织产品边界，Federation 提供共享服务，SDK 与 UI 把这些能力接入真实产品。

这是 Genesis Cosmos 愿景中的一条具体路径：帮助创作者把意图变成可运行系统。更长远的开放创作者经济仍需要产品、市场与所有权机制共同发展；Downcity 先把运行与产品化这一层做好。

## 7. 术语与语气

- 品牌名称建议统一为 Downcity；Genesis Cosmos 官网当前有 DownCity 写法，需负责人确认统一规范。
- Agent 首次可解释为智能体；Harness 解释为执行运行时，不机械翻译成“马具”。
- City 是产品组合与运行边界，不等于现实城市或天然多租户承诺。
- Federation 是共享服务与连接层，不默认等同于去中心化自治、区块链或支付网络。
- “世界”是叙事隐喻，必须由工作空间、角色、工具、服务等具体概念落地。
- Productization Kits 是机制表达，不必让每位用户先理解术语；优先说“把 Agent 做成产品”。

品牌个性：有想象力、克制、开放、工程可信、尊重人的主导权。

写作方法：先说成果，再说机制；先给例子，再给体系；清楚区分已支持、试验中和愿景。技术文档使用精确领域概念，首页减少名词堆叠。

避免：革命性、全球领先、全自动、无限扩展、绝对安全、无需任何技术、自动赚钱；不贬低未经验证的竞争产品。

## 8. 品牌与 SEO 的协作

品牌主张回答为什么值得选择；品类描述回答这是什么；教程与文章回答如何使用及为什么这样设计。

首页可以有想象力，但首屏必须出现清晰的 Agent infrastructure / runtime 描述。信息型搜索由定义、比较、教程承接，不为了搜索量把首页写成百科。中文表达应自然包含智能体运行时等词，不牺牲产品准确性。

品牌不能代替证据。下一步内容素材优先真实运行案例、可复现教程、权限边界说明与架构选择，而不是未经验证的数字。

## 9. 确认状态与剩余边界

用户已确认：Agent 基础设施为主品类；独立 AI builder 与小型团队为优先人群。最新核心价值是让这些用户具备构建、运营自己的 Agent 应用体系的能力，直接收益是减少重复建设，长期收益是积累可复用基础。此前“让 Agent 成为持续运行的产品”不再作为已定核心主张；新的主标题尚未选定。Harness + Productization Kits 用于解释实现层，不取代上层定位。

仍待确认：具体候选文案、商业模式、收费边界、自托管和托管承诺、品牌大小写规范。不推定免费、全部可迁移或已经实现创作者经济全栈。

## 10. 首页段落文案候选

### 价值段

**每个新产品，不必重建同一套基础设施。**

从 Agent 的执行与上下文，到工具、权限和共享服务，Downcity 把重复的基础建设组织成可组合的能力。保留你的产品逻辑，按需要接入运行时、SDK 和界面。

**A new product shouldn't mean a new foundation.**

Compose agent execution, context, tools, permissions, and shared services around your product. Keep your product logic and add the runtime, SDKs, and interfaces you need.

### 三项核心价值

- **让工作接着做。** 用会话、任务与记忆承接工作，不把每次对话都当作新的起点。
- **把能力组合成产品。** 组织 Agent、工具、共享服务和界面，让功能拥有明确的运行边界。
- **始终保留人的控制。** 定义工作空间与权限，检查执行过程，在需要时审批行动。

English:
- **Keep work moving.** Carry work forward with sessions, tasks, and memory.
- **Compose a product around the agent.** Bring agents, tools, shared services, and interfaces into a defined runtime boundary.
- **Keep people in control.** Define workspaces and permissions, inspect execution, and approve actions when needed.

### 架构说明

**从一个 Agent，到一个产品。** Agent Harness 承接执行；City 组织 Agent 与运行资源；Federation 连接共享服务；SDK 与 UI 把这些能力带到用户面前。按你的产品需要组合，不必先接受整套世界观。

**From an agent to a product.** The harness handles execution. City organizes agents and runtime resources. Federation connects shared services. SDKs and UI bring those capabilities into your product.

### 母品牌连接

**创作不只是一份内容，也可以是一个持续工作的系统。** Genesis Cosmos 探索 Agent 时代的开放创作者经济。Downcity 从运行与产品化这一层开始，帮助构建者把想法变成可运行的产品。

**Creation can be more than content. It can be a system that keeps working.** Genesis Cosmos is building toward an open creation economy for the agent era. Downcity contributes the agent runtime and product infrastructure that help builders turn ideas into working products.

### 收尾 CTA

**从你的第一个 Agent 产品开始。** 安装 Downcity，运行示例，再接入你的工具与工作流程。

**Start with your first agent product.** Install Downcity, run an example, and connect your tools and workflows.

主按钮：查看快速入门 / Quick Start。次按钮：探索示例 / Explore Examples。

以上为文档中的内容方案，不代表对应功能已经逐项完成验收；上线前须核对示例、权限行为与链接目的地。

## Changelog

- v3 (2026-10-10) — 根据用户反馈将核心价值从 Agent / 产品的持续运行转向 Builder 构建和运营应用体系的能力；关联专门价值文档，将旧候选文案降为历史参考，暂不选定新主标题。

- v2 (2026-10-10) — 记录用户确认的品类、人群与主张；精简双语定位、Hero 与简介，补充价值段、架构说明、母品牌连接和 CTA 候选；仅修改文档。

- v1 (2026-10-10) — 基于 Genesis Cosmos 公开愿景与 Downcity 当前资料形成品牌叙事、定位和双语候选文案；全部保留为待确认稿，不修改网站。

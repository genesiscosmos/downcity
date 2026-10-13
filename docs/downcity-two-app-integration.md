# 从一个 Agent 应用到第二个：哪些基础可以复用

**日期：**2026-10-12
**状态：**基于当前源码的接入设计；未完成双应用运行验证。仅文档交付，不修改首页、模板或部署。

## 1. 给 Builder 的价值

第一个应用建立运行与交互基础，第二个应用沿用适合共享的部分，把新增开发集中在业务输入、指令、工具和结果呈现上。这是扩大构建范围的路径，不是零成本复制一个产品。

示例使用两个单用户原型：资料整理应用与稿件审查应用。前者只处理用户提供的资料，不宣称具备网络检索；后者只给出审查建议，不宣称自动完成事实核查。两者均需人工核验结果。

## 2. 精确的公开模型接入路径

已核对以下源码：

- `public/packages/federation/src/index.ts`：公开导出 `Embassy` 与 `EmbassyOptions`。
- `public/packages/federation/src/embassy/Embassy.ts`：构造 `user` 客户端。
- `public/packages/federation/src/embassy/types/EmbassyOptions.ts`：接受 `federation_url`、`user_token` 和可选 `fetch`；不负责凭证持久化。
- `public/packages/federation/src/embassy/EmbassyUser.ts`：`user.ai` 暴露 AI 访问器。
- `public/packages/federation/src/pact/invoker/ai/index.ts`：`catalog()` 获取目录，`get()` 或 `require()` 返回可执行模型；缺失模型时 `require()` 抛错。
- `public/templates/agent/server/src/index.ts`：Agent 接受模型，服务端持有 Workspace 与 Session。

以下为源码核对后的接入片段，尚未单独编译或运行：

```ts
import { Embassy } from "@downcity/federation";
import { Agent } from "@downcity/agent";
import { Workspace } from "@downcity/city";

async function create_app(input: {
  id: string;
  instruction: string;
  workspace_path: string;
  federation_url: string;
  user_token: string;
  model_id: string;
}) {
  const embassy = new Embassy({
    federation_url: input.federation_url,
    user_token: input.user_token,
  });
  const catalog = await embassy.user.ai.catalog();
  const model = catalog.require(input.model_id);
  if (model.model_type !== "language" || !model.modalities.includes("stream")) {
    throw new Error("Application requires a streaming language model");
  }
  const agent = new Agent({
    id: input.id,
    model,
    instruction: input.instruction,
  });
  try {
    const workspace = new Workspace({
      id: `${input.id}-workspace`,
      path: input.workspace_path,
    });
    const session = await agent.sessions.create({ workspace });
    return { agent, workspace, session };
  } catch (error) {
    await agent.dispose();
    throw error;
  }
}
```

本片段不引用 CLI 内部函数，不创建登录流程，不读取本机凭证。模型目录发现会访问网络，实际运行须先确认测试服务。凭证只在服务端配置，不能发给浏览器或写入公开记录。应用关闭时需要调用各自 `agent.dispose()`。

两个应用可以使用同一个 Federation URL，但各自的身份与授权必须明确配置。共享 URL、同一模型 ID 或同一份 token 都不能证明应用之间存在安全隔离。目录发现成功也不等于模型请求成功。

## 3. 共享与独立资源

| 资源 | 可以共用 | 必须分别确定 |
|---|---|---|
| Agent SDK | 创建、执行、消息读取与资源释放逻辑 | Agent ID、指令、工具范围 |
| 模型接入 | Embassy / catalog 接入代码、服务入口 | 身份、模型授权、费用归属 |
| Web 交互 | 消息列表和调用适配逻辑 | 输入表单、审查规范、结果样式 |
| Workspace | 创建与管理方式 | 不同 ID 与不同实际路径 |
| Session | 生命周期管理方式 | 每个应用自己的 Session 实例 |
| 业务流程 | 通用输入校验与错误处理 | 整理规则、审查规则、人工验收 |

同一进程中必须保存两份应用实例，HTTP 路由显式选取对应实例；不能继续共用模板中的唯一 `session_promise`。不同 Workspace 路径只说明资源配置分离，不等于沙箱权限测试通过。

## 4. 阶段 A：不接外部服务的最小验证

目标是确认双应用接线，不评估真实模型能力。

1. 核对 ModelClient / ModelCall / ModelStreamEvent 协议，按当前协议制作确定性模拟模型，不猜事件格式。
2. 用临时测试路径分别创建 `source-organizer` 与 `draft-reviewer`；各自创建 Session。
3. 向应用 A 输入唯一标记 `APP_A_ONLY`，向 B 输入 `APP_B_ONLY`。
4. 分别读取 canonical 消息，断言各自包含本应用用户标记，不包含另一个应用用户标记。
5. 保存模拟结果、消息断言、应用配置与共享模块清单；在 finally 中释放 Agent。
6. 增加错误路由、空输入与模拟模型失败测试。错误不得把请求转发到另一个应用。

验收指标：2 个独立实例；两组消息归属断言通过；错误场景不串线；共享/独立模块均列出。即使全部通过，也只能称为接线与消息归属测试，不是跨用户授权或文件访问隔离测试。

## 5. 阶段 B：共享服务运行验证

前置条件：明确可信 Federation URL、测试身份配置、模型 ID、调用次数与费用上限。由用户在 Global / Env 或所属配置界面维护凭证，不在聊天提供秘密值。

1. 分别获取目录，记录模型 ID 和可用能力，不记录 token。
2. 每个应用各执行一个固定输入，记录成功或失败、输出、可用用量记录。
3. 测试目录缺失模型；应明确失败，不静默切换供应商。
4. 在受控测试身份下验证拒绝访问场景，区分服务端拒绝与客户端校验。
5. 检查失败后的历史与资源释放；不要把失败吞掉后写成成功案例。

未核查身份与授权策略之前，不设计越权读取真实用户数据的测试；使用专用测试资源。

## 6. 当前可以公开的内容

可以说：Downcity 有 Agent Web 模板，也有通过 Embassy 模型目录获取执行模型的公开接口；两个应用可采用相同接入模式，各自配置业务与资源。

暂不能说：双应用共享基础已经跑通、天然多租户隔离、自动事实核查、一人替代团队、提效若干倍。

该文章的搜索意图是 Agent 应用开发与集成方案评估。优先讲解可复用模块、接入步骤和边界，产品品类词放在解释中，不让架构名词取代用户价值。未开展搜索量研究，不提供搜索量或排名预测。

## 7. 验证记录状态

| 项目 | 状态 |
|---|---|
| Federation 公共入口与参数核查 | 已完成源码核对 |
| 目录返回可执行模型链路 | 已完成源码核对 |
| 文中片段独立类型检查 | 未执行 |
| 双应用模拟运行与消息断言 | 未执行 |
| 真实模型调用与授权测试 | 未执行 |
| 首页或模板代码修改 | 未执行 |

## 8. 下一步

1. 按仓库现有测试方式实现阶段 A，先验证协议与消息归属。
2. 测试通过后整理共享代码清单；失败和限制一并保留。
3. 在服务、身份与费用边界明确后执行阶段 B，再将场景说明升级为可复现案例。

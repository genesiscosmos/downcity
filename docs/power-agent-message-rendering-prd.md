# Power Agent Message 渲染插口 PRD

> 状态：历史设计参考，实施合同已由 [Power 消息渲染与 Presentation PRD](presentation-power-prd.md) 统一。
>
> 本文保留原 diagram / SeeCode 方案的设计依据。当前实施以新 PRD 为准：先建设通用 Power 消息渲染底座，再以 Presentation / json-render 验证；diagram 为后续复用方。
>
> 文档性质：原 Power 消息输出协议与宿主渲染能力设计。

## 1. 产品目标

Power 的 Action 可以直接生成一个 Agent Message Part。该 Part 由所属 Power 的消息渲染组件解释，在 Agent 回复中展示自定义内容。

用户要求画图后，Agent 调用 diagram.render，回复中直接出现可操作的图形。用户不需要复制代码或打开本地文件才能查看图形。

本次核心交付是通用 Power 消息渲染插口；SeeCode 用于验证完整链路。后续 Power 可以通过相同协议输出其他业务内容，不需要在聊天组件中增加业务特例。

## 2. 可行性结论与现状

可以实现。现有架构已拥有 Action 结果追加、canonical Message Parts、SQLite 持久化、实时消息更新以及 Power Renderer 注册机制。需要扩展这些既有边界。

已核对的实现依据：

| 现有入口 | 当前能力 | 本次改动 |
| --- | --- | --- |
| public/packages/type/src/types/session/SessionActionContract.ts | ActionResult.messages 支持 role=agent，并声明写入当前 canonical 回复 | 沿用该通道返回 Power 内容 |
| public/packages/type/src/types/session/SessionContent.ts | Agent 内容支持 text、file、data | 增加 power 内容协议 |
| public/packages/type/src/types/session/SessionMessage.ts | canonical Part 具有 part_id、sequence、可选 step_id | 增加 Agent Power Part |
| public/packages/agent/src/session/storage/SessionStorageSchema.ts | message_parts.content 保存 JSON；类型与角色存在数据库约束 | 更新约束、编解码与存储迁移 |
| public/packages/city/src/power/types/PowerRenderer.ts | Renderer 插槽为 sidebar、mainview、config | 增加 message 插槽 |
| public/packages/implementations/powers/src/renderers.ts | 官方 Power ID 到 Renderer 的注册映射 | 注册 diagram 消息渲染器 |
| private/apps/desktop/src/renderer/features/chat/lib/message/agent_message_projection.ts | 单层消息投影；data 当前主要展示文件改动 | 增加 Power 内容投影与分发 |

现有追加链路仍需在实施阶段验证实际调用入口、并发动作和实时 Mutation；不能仅新增类型后就视为完成。

## 3. 用户流程

```text
用户要求画图
  → Agent 生成 SeeCode spec
  → Agent 调用 diagram.render
  → Action 校验、渲染，返回 ActionResult
  → 运行时将 power part 追加到当前 Agent Message
  → 前端通过 power_id 查找 message 渲染器
  → diagram 渲染器在消息中展示交互图
```

Action 完成后，Part 即可显示，不等待模型最终文字回复。Agent 可以继续解释图形。

缩放、悬停、动画等操作由图形渲染器本地完成。修改图形由新的 Action 调用生成新 Part。

## 4. 范围

本期包含：

- Agent 专属 power Part 内容协议与 canonical 类型。
- Power 的 message 渲染插槽。
- ActionResult 到当前 Agent Message 的持久化与实时展示。
- Desktop 的通用 Power Part 分发、回退与渲染错误隔离。
- 基于 SeeCode 的 diagram Power 与交互式消息渲染器。
- 历史消息重放、消息可见性及外部渠道文字回退。
- homepage 中的 Power 开发和消息渲染文档。

本期不扩展图形点击到 Session 的双向业务事件，不实现通用可视化编辑器，不增加独立 diagram 工作区。不要求 PNG、视频导出，也不实现增量更新已发布的 Power Part。

## 5. 消息协议

新增 SessionPowerContent，进入 SessionAgentContent；User 内容集合不增加 power。

协议字段：

| 字段 | 约束与含义 |
| --- | --- |
| type | 固定为 power |
| power_id | 内容所属 Power 的稳定 ID，也是渲染器查找键 |
| schema_version | 所属 Power 数据协议的正整数版本，由该 Power 解释 |
| data | 可序列化 JSON 值，具体结构由所属 Power 定义 |
| fallback_text | 必填非空文本，用于无渲染器、渠道回退、复制和摘要 |

持久化后形成 SessionAgentPowerPart，由运行时增加 part_id、sequence 和可选 step_id。Action 不指定消息或 Part 身份；身份与顺序仍由 Session 分配。

每个 Power 一个 message 渲染入口；Power 内部有多种展示时，可在 data 中定义自己的判别字段。宿主不需要理解这些业务字段。

## 6. Action 返回与发布语义

复用 ActionResult，不新增发布消息工具或独立事件通道。

```json
{
  "output": {
    "ok": true,
    "title": "消息处理流程",
    "problems": []
  },
  "messages": [
    {
      "role": "agent",
      "parts": [
        {
          "type": "power",
          "power_id": "diagram",
          "schema_version": 1,
          "data": {
            "title": "消息处理流程",
            "spec": { "type": "architecture", "nodes": [], "edges": [] }
          },
          "fallback_text": "消息处理流程交互图"
        }
      ]
    }
  ]
}
```

output 是模型读取的简短执行结果；messages 是直接发布到当前 canonical 回复的内容。模型无需复述或复制 Part。

运行时校验外壳字段、JSON 可序列化性、数据大小和来源归属。通过 Power Action 输出的 power_id 必须与实际调用的 Power 一致，归属判断使用可信调用上下文。Power 负责校验自己的 data 协议。

Action 执行失败时返回问题，不发布成功内容 Part。产物生成完成且通过校验后，随 ActionResult 发布。沿用既有 Turn 停止和执行结果处理语义，防止已停止调用迟到写入错误消息。

并发完成的 Part 按 canonical sequence 展示。既有执行结果的重复处理不得造成同一结果重复追加；模型主动再次调用属于新的执行，可以生成新 Part。

## 7. Power Renderer 插槽

在 PowerRendererDefinition 中增加可选 message 组件。仅声明 message 的 Power 是合法定义，不要求同时提供 sidebar 或 mainview。

宿主根据 Part.power_id 找到已注册 Power Renderer，并调用其 message 组件。

组件输入包含：

- canonical Power Part，包含协议版本与业务数据。
- 当前 Session、Message 的必要展示身份。
- 宿主统一提供的主题与展示容器约定。

最终类型沿用已有 Power Renderer 的 Context 设计，实施时仅加入实际需要的能力。首版不向消息组件开放 Shell、任意文件读取或直接调用 Agent 的接口。

官方 Power 与本地插件使用同一个 message 槽定义。本地插件加载路径必须支持该槽；不得仅对内置 diagram 写专用分支。

每个 Power ID 只能绑定一个有效 Renderer 定义，沿用现有注册冲突处理规则。

## 8. Desktop 消息展示

Power Part 是回复内容，独立于 Tool 执行记录。Tool Part 继续保留调用输入、状态和简短结果。

当前投影按最后一个活动块划分过程与正文。新增 Power Part 后，必须保证其持续可见：即使后续仍有 Tool 调用，也不能将已发布图形藏入过程折叠。

实现应在现有单层投影中处理内容和过程归属，避免复制一套消息模型。Power Part 之间保持 canonical sequence；若影响其他内容排序，需显式验证现有文件改动卡片、错误与正文规则。

消息流中使用稳定 part_id 作为组件身份。消息级更新、离屏卸载再挂载、切换会话后，图形可重新展示。图形渲染器不得使流式文字更新反复重建图形。

每个 Power 消息组件使用独立错误边界。缺少 Renderer、版本不支持或组件报错时显示 fallback_text 和明确的不可展示状态；同一条消息的其余内容继续显示。

## 9. SeeCode 首个实现

业务 Power ID 为 diagram，内部使用固定版本的 SeeCode 渲染内核。

首版动作：

| Action | 输入 | 输出与发布 |
| --- | --- | --- |
| diagram.types | 无 | 返回图类型摘要，不发布 Part |
| diagram.validate | spec | 返回问题与修正建议，不发布 Part |
| diagram.render | spec | 成功时返回摘要并直接发布包含 spec 的 power Part；失败时返回问题 |

Agent 通过 Power 提示和图类型说明生成 spec。渲染动作不额外调用模型，也不承担代码理解。

首版 data 协议为 title 和 spec，持久化结构化图形描述。diagram.render 在发布前使用同版本的共享渲染内核校验和计算图形，成功后发布 spec；message 组件使用同一内核生成 SVG。数据超过明确的 payload 上限时返回错误，不静默截断。实施前根据代表性图形确定并记录具体上限。

diagram.message 是通过 Power Renderer 注册并由宿主直接挂载的 React 组件，加载机制与 config 等插槽一致，不使用 iframe。将 SeeCode 的布局和 SVG 生成逻辑提取为浏览器与 Action 共用的渲染内核，分离 Node 文件读取、配置加载和 HTML 页面拼装。图类型 schema 随内核打包，图表数据必须以内联值传入，消息渲染不能读取任意本地数据文件。组件只插入内核生成并经过安全检查的 SVG，不接收任意 HTML 或执行返回数据中的脚本。

React 组件管理工具栏、悬停、聚焦、缩放、动画开关和展开操作。可复用 SeeCode 的几何、动画和交互算法，但必须将原有依赖 document 全局查询的查看器改为组件容器内操作；卸载时清理监听器和动画。SVG 标识按 Part 实例隔离，CSS 作用域限制在图形容器，确保同一消息中的多张图互不影响，样式与主题遵循 Power Renderer 的宿主约定。

固定上游版本，保留 MIT 版权和许可；沿用项目现有第三方源码管理约定。执行环境遵循 Workspace Sandbox 和 Power 的现有边界，不能因渲染需求改为未授权 host 执行。

## 10. 存储、上下文与渠道

新增 power 类型需要同步修改 SQLite CHECK 约束和角色校验触发器。已有数据库必须通过项目原生迁移机制升级，保留消息和 Part 身份；不能依赖 CREATE TABLE IF NOT EXISTS 修改旧约束。

同步更新存储 Codec、消息构造、实时 Mutation、读取验证、消息预览和内容复制等所有穷尽分支。

HTML 和其他业务 data 不自动进入模型上下文。当前调用的 output 提供执行摘要；历史 Power Part 如需参与上下文，只投影 fallback_text。上下文合成路径需确保既不遗漏必要摘要，也不重复灌入完整数据。

外部渠道无法执行自定义 Renderer 时发送 fallback_text。公共 UI 或导出消费方至少认识该协议并提供回退，不能因新增 Part 而崩溃。Part 与历史消息生命周期一致，删除消息时不另留独立业务快照。

## 11. 实施顺序

1. 定义 power 内容、canonical Part 和 message Renderer 槽；更新公开导出。
2. 接通 Action 结果校验、消息追加、持久化迁移、Mutation 与上下文投影。
3. 接通宿主的 Renderer 注册和 Desktop 消息分发、错误回退、可见性规则。
4. 集成 SeeCode，完成 diagram.render 到内联交互图的完整链路。
5. 验证历史消息、失败场景、流式更新与外部渠道回退，更新开发者文档。

实施阶段按现有仓库规范编写模块注释、字段注释与 snake_case 变量、函数；避免扩大到无关重构。

## 12. 验收标准

- Agent 调用 diagram.render 后，无需生成额外 Markdown，当前回复出现图形。
- Part 为 type=power、power_id=diagram，由通用分发器调用 diagram.message。
- Chat 组件不直接依赖 SeeCode，也不写 diagram 专属业务解析。
- 图形由 Power 注册的 React message 组件直接挂载，不使用 iframe，不执行消息数据中的脚本。
- 图形支持悬停、点击聚焦、缩放和动画；图形操作不调用模型；多图样式、SVG 标识和事件互不干扰。
- Part 立即显示，后续工具执行和过程折叠不隐藏图形。
- 重启后历史图形仍可展示；缺少 Power Renderer 时显示回退。
- 非法 spec 不发布成功图形，返回 Agent 可用的修正信息。
- 渲染器异常、协议版本不支持、超大数据均得到明确处理，其他消息内容正常显示。
- 本地 Power 可注册仅 message 的 Renderer，通过同一协议展示自己的内容。
- 存储升级保留原有消息；旧类型和角色约束继续有效。
- output 保持简短，完整 spec 或 SVG 不进入模型 Tool Result 或历史上下文。
- 相关包类型检查、现有消息存储与投影检查通过，完成 Desktop GUI 手动验收。

## 13. 风险与待验证事项

可行性已确认，以下事项需在实施中验证，而不是对用户追加前置确认：

- SQLite 实际迁移入口及所有消息消费分支的覆盖范围。
- 本地 Power Renderer 的加载方式是否需要同步扩展描述与验证。
- SeeCode 内核的浏览器兼容性，以及 React 组件中多图交互、主题隔离和卸载清理的表现。
- 代表性图形的 payload 大小与长会话存储开销。
- Power Part 可见性规则对现有过程、正文顺序的影响。

本 PRD 定义的是设计合同，不代表上述功能已经实现。

# Power 消息渲染开发约定

本文说明 `power` 内容与 `message` Renderer 的接入契约。产品范围与验收合同见 [Presentation PRD](presentation-power-prd.md)。

## 内容发布

Power Action 通过现有 `PowerActionResult.messages` 返回 Agent 内容：

```ts
return {
  success: true,
  data: { published: true },
  messages: [{
    role: "agent",
    parts: [{
      type: "power",
      power_id: "example",
      schema_version: 1,
      data: { title: "示例内容" },
      fallback_text: "示例内容的可读摘要",
    }],
  }],
};
```

运行时验证外壳、大小和实际调用 Power 的归属，所属 Power 验证业务数据。`power_id` 不能冒充另一个 Power。失败的 Action 不得发布成功内容。

Session 分配 `part_id`、`sequence`，执行运行时额外绑定 `source_tool_call_id`；这些字段不由模型指定。Action 完成时内容即可追加；Step 收口合并已经发布的 canonical Parts，不重复写入。

canonical Tool 记录保留原始输入供审阅。进入模型历史和压缩摘要时，已发布 Power 内容对应的调用参数替换为显式标记的摘要投影，Power Part 使用 `fallback_text`，不重复发送完整 Spec。

## Renderer 注册

Renderer ESM 默认导出 `PowerRendererDefinition`。`message` 可以独立存在，不要求 Sidebar、Mainview 或 Config。

```tsx
import { createElement } from "react";
import { define_power_renderer } from "@downcity/city/power/react";

export default define_power_renderer({
  message: ({ part }) => {
    if (part.schema_version !== 1) throw new Error("Unsupported example schema");
    return createElement("p", null, part.fallback_text);
  },
});
```

本地 Power 的静态 Renderer 声明示例：

```json
{
  "renderer": {
    "entry": "renderer.js",
    "sidebar": false,
    "mainview": false,
    "config": false,
    "message": true
  }
}
```

`entry` 遵循现有安装路径校验。官方 Power 在 `@downcity/powers/renderers` 注册，宿主按实际安装身份选择内置定义或本地 Renderer URL。

## 消息组件输入

- `part`：canonical Power 内容与版本。
- `session_id`、`message_id`：可信展示身份。
- `read_state()`、`save_state(state)`：当前 Part 的本地可恢复视图状态。
- `submit({ question, parameters })`：用户明确操作后向当前对话提交问题与参数。

这些端口不提供任意 Session 路由、Shell、文件读取或 Power 执行能力。Renderer 自身是已经安装的可信 ESM；消息里的 JSON 数据仍必须校验，不能被当作任意代码执行。

Desktop 缓存按 Session / Message / Part 定位，最多保留最近 100 个视图，整体不超过 2 MiB；它是有界本地缓存，不是业务事实源。Presentation 另外将参数限制为 64 KiB，并使用内容指纹失效缓存。用户提交最多 16 KiB，仅包含组件声明的字段。缓存不可用时交互继续，刷新恢复不作保证。

组件在卸载时清理监听器、动画与订阅。宿主按 Part 隔离渲染异常；不存在 Renderer 或版本不支持时保留 `fallback_text`。不同内容实例不能共享可变状态。

## 正文与渠道

Desktop 使用一条按 canonical sequence 排列的可见内容流。文字、Power、附件、文件改动卡片和错误都保持原位；相邻工具、推理与 Action 形成活动块，在所在位置管理折叠。消息不再分成顶部过程区与底部正文区，也不将文件改动卡片移至末尾。

当消息中存在带 `source_tool_call_id` 的 Power Part，对应 Tool 已 completed 且没有 pending Interaction 时，投影省略该 Tool 的重复活动。执行中、失败、待响应以及没有关联产物的工具继续展示。原始 Tool 记录不删除；模块无法渲染时仍显示其 fallback_text。

Presentation 提示模型在说明中需要模块的位置调用 show，发布后继续解释。前端尊重实际产生顺序；若模型最后才调用 show，模块仍会位于最后，不能由宿主猜测插入到之前的文字段落。

预览、复制、搜索、文本渠道和公共 UI 的最小回退读取 `fallback_text`。增加其他渠道时应复用 canonical 文本投影，不能只筛选 `type=text`。

## Presentation 实现

Presentation 已切换 OpenUI。`OpenUICatalog.ts` 使用构建生成的纯 JSON Schema 校验内容，浏览器 `PresentationLibrary.ts` 从实际组件库注册同源目录。构建脚本生成 Schema 与模型说明，服务端公开入口不加载 React Renderer。

固定版本为 lang-core 1.0.1、react-lang 1.0.1、react-ui 0.18.1（MIT）。发布内容 schema_version=2，data 为 `{format:"openui-lang", catalog_id:"downcity.presentation.openui.v1", content:string}`。旧 schema_version=1 仅文字回退。

Renderer 可声明纯函数 `preview(tool)` 返回只读 Power 内容。Desktop 首轮只对尾部 Tool 使用内置 Renderer 的预览，避免并发内容引起顺序跨越；完整结果通过 source_tool_call_id 对应稳定组件 key。预览由 Tool 输入派生，不额外持久化、不允许交互提交或保存为成功状态。

OpenUI 生成语句采用 root 在前和前向引用，已闭合且通过局部校验的语句可提前显示；Action 最终执行完整校验。Query、Mutation、Run、OpenUrl 禁用，toolProvider 不注入。纯本地状态和受限的继续对话通过既有端口处理。复利计算使用共享函数 CompoundValues / YearLabels。

宿主加载 `@downcity/powers/presentation/styles.css`，Tailwind 层顺序为 theme、base、openui、components、utilities。上游 React Lang 开发构建会自动挂载 Inspect，生产构建根据 NODE_ENV 移除；不要把开发验收页面当作发行效果。

不支持增量修改已发布描述、跨设备状态同步、任意业务动作和代码沙箱。完整限制与验收记录见 OpenUI 迁移说明。

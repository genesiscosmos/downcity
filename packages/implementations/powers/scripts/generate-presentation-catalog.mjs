/** 从实际 OpenUI 组件导出纯 JSON Schema 与模型提示，保证服务端不导入 React。 */
import { writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";

// 仅在生成脚本加载 TS 源码期间映射同目录 .js 引用；发布代码仍使用标准 ESM 路径。
const hooks = registerHooks({ resolve(specifier, context, next_resolve) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.includes("/src/presentation/")) return next_resolve(specifier.slice(0, -3) + ".ts", context);
  return next_resolve(specifier, context);
} });
const { PRESENTATION_LIBRARY } = await import("../src/presentation/renderer/PresentationLibrary.ts");
hooks.deregister();

const prompt = PRESENTATION_LIBRARY.prompt({ toolCalls: false, bindings: true });
await writeFile(new URL("../src/presentation/openui-catalog.json", import.meta.url), JSON.stringify({
  schema: PRESENTATION_LIBRARY.toJSONSchema(),
  // 上游面向全回答的说明只在 show.content 中生效，不能覆盖 Agent 的文字与工具选择。
  prompt: `The following language instructions apply ONLY to presentation.show content, not to the entire assistant reply.\n${prompt}\nDowncity rules: only local state, @Set, @Reset and @ToAssistant are allowed. Never use Query, Mutation, @Run or @OpenUrl. Images may use genuine http(s) URLs, inline raster data or absolute local paths authorized by the Desktop host. Never invent image URLs; use text-only cards when no real image is available. CodeBlock only displays code, never executes it. Write root first. Place charts, tables and controls where useful; continue normal prose outside the tool call. Visual composition: use one root Stack with medium gaps; avoid nested decorative Cards and repeated headings. Order explanatory modules as a short CardHeader, key metrics, chart, compact parameter controls, and one Buttons row. Use MetricIndicatorInline for actual headline values, not every number. Keep labels and descriptions brief. Prefer one primary action; Reset and secondary actions use tertiary style. Use a wrapping row Stack for related controls so narrow containers can wrap. Preserve meaningful units and comparison-series labels. Use CompositeCardBlock for products, ContextCardBlock for concepts, EntityList for compact facts, Steps for processes, and OptionCards or Chips for short choices. Include matching Item components in block arrays; do not imitate them with excessive nested Cards. Input names must be unique and meaningful; form submission includes current fields. Images need descriptive alt text and icon-only actions need accessible names.`,
}, null, 2) + "\n");

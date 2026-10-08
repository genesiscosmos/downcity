/**
 * CodeBlock 示例。
 *
 * 该组件只负责布局与复制交互，语法高亮由构建期完成；未高亮的代码会走轻量着色兜底。
 */
import { CodeBlock } from "@downcity/ui";

const sample = `import { Agent } from "@downcity/agent";

const agent = new Agent({
  id: "repo-helper",
  instruction: "You are a reliable project assistant.",
});`;

export default function CodeBlockPreview() {
  return (
    <CodeBlock
      className="w-full max-w-md"
      code={sample}
      language="ts"
      label="agent.ts"
    />
  );
}

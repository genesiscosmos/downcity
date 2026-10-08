/**
 * Typography 示例。
 *
 * 这里从 H2 开始展示：文档页的页面标题本身就是由 H1 渲染的，示例里再放一个 H1
 * 会让同一页出现两个主标题，既破坏大纲，也让屏幕阅读器重复播报。
 *
 * 标题层级只用于表达结构，不用来调节视觉大小；需要更大的字号应该调整版式，
 * 而不是把标题降到更深层级。
 */
import { H2, H3, H4, Lead, Paragraph, Muted, Strong, Small } from "@downcity/ui";

export default function TypographyPreview() {
  return (
    <div className="w-full max-w-lg space-y-4">
      <Lead>The layer that turns a model into a working agent.</Lead>
      <H2>Agent runtime</H2>
      <Paragraph>
        Sessions own context and tool state. <Strong>Approvals</Strong> stay explicit, and{" "}
        <Muted>usage is metered per turn</Muted>.
      </Paragraph>
      <H3>Subsystem</H3>
      <Paragraph>Each request passes through the same ordered pipeline.</Paragraph>
      <H4>Recovery</H4>
      <Small>Retries are bounded and observable.</Small>
    </div>
  );
}

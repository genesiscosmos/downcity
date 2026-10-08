/**
 * Spinner 示例。
 *
 * 加载态只在等待确实会发生且时长不可预期时使用；按钮内的等待不要叠加 Spinner。
 */
import { Spinner } from "@downcity/ui";

export default function SpinnerPreview() {
  return (
    <div className="flex items-center gap-4">
      <Spinner size="sm" />
      <Spinner size="default" />
      <Spinner size="lg" />
    </div>
  );
}

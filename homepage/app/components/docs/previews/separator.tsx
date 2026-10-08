/**
 * Separator 示例。
 */
import { Separator } from "@downcity/ui";

export default function SeparatorPreview() {
  return (
    <div className="w-full max-w-sm">
      <p>Above the divider</p>
      <Separator className="my-3" />
      <p>Below the divider</p>
      <div className="mt-4 flex h-10 items-center gap-3">
        <span>Left</span>
        <Separator orientation="vertical" />
        <span>Right</span>
      </div>
    </div>
  );
}

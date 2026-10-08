/**
 * Skeleton 示例。
 *
 * 骨架屏的尺寸应与最终内容的真实尺寸一致，否则内容出现时会发生跳动。
 */
import { Skeleton } from "@downcity/ui";

export default function SkeletonPreview() {
  return (
    <div className="flex w-full max-w-sm items-center gap-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

/**
 * Button 尺寸示例。
 */
import { Button } from "@downcity/ui";

export default function ButtonSizesPreview() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

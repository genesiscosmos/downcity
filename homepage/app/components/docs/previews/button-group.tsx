/**
 * ButtonGroup 示例。
 *
 * ButtonGroup 只负责布局与相邻边界合并，每个 Button 仍保留自己的变体与层级。
 */
import { Button, ButtonGroup } from "@downcity/ui";

export default function ButtonGroupPreview() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ButtonGroup>
        <Button variant="outline">Day</Button>
        <Button variant="outline">Week</Button>
        <Button variant="outline">Month</Button>
      </ButtonGroup>
      <ButtonGroup orientation="vertical">
        <Button variant="outline">Top</Button>
        <Button variant="outline">Middle</Button>
        <Button variant="outline">Bottom</Button>
      </ButtonGroup>
    </div>
  );
}

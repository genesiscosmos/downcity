/**
 * Kbd 示例。
 */
import { Kbd, KbdGroup } from "@downcity/ui";

export default function KbdPreview() {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Kbd>⌘</Kbd>
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>Shift</Kbd>
        <Kbd>P</Kbd>
      </KbdGroup>
    </div>
  );
}

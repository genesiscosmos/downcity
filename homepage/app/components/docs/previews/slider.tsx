/**
 * Slider 示例。
 */
import { Slider } from "@downcity/ui";

export default function SliderPreview() {
  return (
    <div className="grid w-full max-w-sm gap-4">
      <Slider defaultValue={[40]} max={100} step={1} />
      <Slider defaultValue={[20, 70]} max={100} step={1} />
    </div>
  );
}

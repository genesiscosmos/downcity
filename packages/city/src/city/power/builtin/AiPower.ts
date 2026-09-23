/**
 * AI Power：City 自己拥有的图像与语音能力的具名 power。
 *
 * 关键点（中文）
 * - 模型侧工具名是 `ai`；动作 id 由组名拼成，与拆分前完全一致：
 *   `image.*`、`sound.*`。
 * - 这些动作会消耗额度或写文件，各自动作自行声明 `access` 与 `approval`。
 * - 能力来自 City 持有的 Embassy；未配置时动作返回 `unsupported_action`，不伪造结果。
 */

import type { CityActionGroup } from "@/city/power/builtin/CityActionGroup.js";
import { CityGroupPower } from "@/city/power/builtin/CityGroupPower.js";
import type { CityGroupPowerOptions } from "@/city/power/builtin/CityGroupPower.js";
import { ImageGroup } from "@/city/power/builtin/groups/image/ImageGroup.js";
import { SoundGroup } from "@/city/power/builtin/groups/sound/SoundGroup.js";

/** AI Power：通过 City 持有的模型生成图片、转写与合成语音。 */
export class AiPower extends CityGroupPower {
  readonly name = "ai";
  readonly title = "AI";
  readonly description =
    "City-owned generation models: image generation and speech recognition/synthesis.";

  constructor(options: CityGroupPowerOptions) {
    super({
      groups: create_ai_action_groups(),
      options,
    });
  }
}

/** 创建 AI Power 的动作组；顺序即模型侧索引顺序。 */
function create_ai_action_groups(): CityActionGroup[] {
  return [new ImageGroup(), new SoundGroup()];
}

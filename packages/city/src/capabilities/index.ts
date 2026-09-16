/**
 * City 内置 capability 注册集合。
 *
 * 关键点（中文）
 * - 这些能力由 City 自己拥有：能力来源是 City 的 Embassy 与当前 Workspace，
 *   没有账号、凭据、设置页与安装协议。
 * - 新增一个 capability 只需要新增一个文件，并在这里加一次登记。
 */

import type { CityCapability } from "@/capabilities/types/CityCapability.js";
import { create_image_capability } from "@/capabilities/image/ImageCapability.js";
import { create_sound_capability } from "@/capabilities/sound/SoundCapability.js";

/** 创建当前全部内置 capability。 */
export function create_builtin_capabilities(): CityCapability[] {
  return [
    create_image_capability(),
    create_sound_capability(),
  ];
}

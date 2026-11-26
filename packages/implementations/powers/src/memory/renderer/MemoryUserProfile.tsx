/** User 持续约定按条管理，正文投影来自统一 records。 */
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import { Memory_records_view } from "./MemoryRecordsView.js";
export function memory_user_profile(props: PowerMainviewComponentProps) {
  return <Memory_records_view power={props.power} ui={props.ui} scope="user" kind="agreement" />;
}

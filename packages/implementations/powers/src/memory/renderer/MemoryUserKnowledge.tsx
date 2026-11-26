/** User Knowledge 使用真实标题和正文及统一版本。 */
import type { PowerMainviewComponentProps } from "@downcity/city/power/react";
import { Memory_records_view } from "./MemoryRecordsView.js";
export function memory_user_knowledge(props: PowerMainviewComponentProps) {
  return <Memory_records_view power={props.power} ui={props.ui} scope="user" kind="knowledge" />;
}

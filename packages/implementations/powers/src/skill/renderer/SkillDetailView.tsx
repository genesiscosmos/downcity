/** Skill 独立详情：仅根据宿主输入读取已安装正文，tab 生命周期由宿主管理。 */
import { useEffect, useState } from "react";
import type { PowerViewComponentProps } from "@downcity/city/power/react";
import type { SkillMainviewReadResult } from "@/skill/types/SkillMainview.js";
import { error_message } from "./SkillResources.js";
import { Skill_document } from "./SkillDocument.js";

/** 资源身份变化时重建读取状态，同一资源刷新时保留最近成功的正文。 */
export function skill_detail_view(props: PowerViewComponentProps) {
  return <Skill_detail key={JSON.stringify([props.input.agent_id, props.input.skill_id])} {...props} />;
}

/** 详情不依赖资源列表，也不持有关闭或返回列表操作。 */
function Skill_detail({ input, power, ui }: PowerViewComponentProps) {
  const { Page, Section, Toolbar, Button, Callout, LoadingState } = ui.components;
  const agent_id = typeof input.agent_id === "string" ? input.agent_id : "";
  const skill_id = typeof input.skill_id === "string" ? input.skill_id : "";
  const skill_name = typeof input.skill_name === "string" ? input.skill_name : skill_id;
  const skill_description = typeof input.skill_description === "string" ? input.skill_description : "";
  const [content, set_content] = useState<string>();
  const [error, set_error] = useState("");
  const [reading, set_reading] = useState(true);
  const [read_revision, set_read_revision] = useState(0);
  useEffect(() => {
    let disposed = false;
    if (!agent_id || !skill_id) {
      set_error("缺少 Agent 或 Skill 标识");
      set_reading(false);
      return;
    }
    set_reading(true);
    void power.invoke<SkillMainviewReadResult>("skill.read", { agent_id, skill_id }).then((result) => {
      if (disposed) return;
      if (!result.success) {
        // 业务失败说明正文已不可用；只有网络等调用异常才保留最近成功的正文。
        set_content(undefined);
        set_error(result.error || "读取失败");
        return;
      }
      set_content(result.content ?? "");
      set_error("");
    }).catch((reason) => { if (!disposed) set_error(error_message(reason)); })
      .finally(() => { if (!disposed) set_reading(false); });
    return () => { disposed = true; };
  }, [agent_id, skill_id, power, read_revision, ui.revision]);
  const retry_action = error ? <Button disabled={reading} on_click={() => set_read_revision((value) => value + 1)}>{reading ? "读取中…" : "重试"}</Button> : undefined;
  return <Page><Section surface={false}>
    {content === undefined ? <Toolbar title={skill_name} actions={retry_action} /> : null}
    {error ? <Callout tone="danger">{error}</Callout> : null}
    {content !== undefined ? <Skill_document ui={ui} content={content} fallback_name={skill_name} fallback_description={skill_description} actions={retry_action} /> : reading ? <LoadingState label="正在读取 Skill…" /> : null}
  </Section></Page>;
}

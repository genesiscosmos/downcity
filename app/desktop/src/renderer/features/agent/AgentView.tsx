/** Agent 身份、配置索引与 MainView 定义编辑内容。 */

import { useEffect, useRef, useState } from "react";
import { TbChevronRight, TbFileText, TbMessageCircle, TbPhoto, TbRefresh, TbTrash, TbUser } from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LLMModelIcon } from "@/components/model/LLMModelIcon";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SettingActionItem, SettingGroup, SettingSection, SettingsContainer, SettingsMainContent } from "@/components/settings/SettingComponents";
import { use_baybar_open, baybar_tab_id, type BayBarTab, type BayBarTranslate } from "@/layouts/BayBar";
import { use_agent_definition } from "@/features/agent/lib/use_agent_definition";
import { MainViewBody, MainViewHeader } from "@/layouts/MainViewLayout";
import { AgentAvatar } from "@/components/AgentAvatar";
import { use_desktop_selector } from "@/app/use_desktop";
import { use_translation } from "@/locales/i18n";
import type { DesktopController } from "@/types/DesktopView";
import type { DesktopAgentDefinition, DesktopAgentSummary, DesktopSessionSummary } from "@common/types/DesktopApi";

/** Agent 页面可以编辑的定义分区。 */
export type AgentEditorSection = "identity" | "model" | "soul";

/** Agent 定义分区；每个 Agent 的 tab 下的二级分区。
 *
 * 只描述分区标识与文案，具体内容由页面组装为 tab，避免视图层重复一次翻译表。
 */
export const AGENT_EDITOR_SECTIONS: readonly { id: AgentEditorSection; label_key: string | null; label?: string }[] = [
  { id: "identity", label_key: "agent_details.identity" },
  { id: "model", label_key: null, label: "Model" },
  { id: "soul", label_key: null, label: "SOUL.md" },
];

/** Agent 单个分区的内容属性。 */
interface AgentEditorPanelProps {
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** Renderer 根控制器。 */ controller: DesktopController;
  /** 当前编辑分区。 */ section: AgentEditorSection;
  /** 当前未保存的定义。 */ definition?: DesktopAgentDefinition;
  /** 是否正在读取定义。 */ loading: boolean;
  /** 当前编辑错误。 */ error: string;
  /** 替换未保存的定义。 */ set_definition(value: DesktopAgentDefinition): void;
}

/**
 * Agent 单个分区的编辑内容。
 *
 * 纯视图：定义状态由页面通过 use_agent_definition 持有，分区导航由 BayBar 负责，
 * 因此切换分区或域都不会重新请求，也不会丢失正在编辑的内容。
 */
export function AgentEditorPanel({
  agent,
  controller,
  section,
  definition,
  loading,
  error,
  set_definition,
}: AgentEditorPanelProps) {
  const translate_common = use_translation();
  return <div className={`h-full min-h-0 w-full ${section === "soul" ? "" : "p-2"}`}>
    {loading && !definition ? (
      <div className="py-10 text-center text-xs text-muted-foreground">
        {translate_common("state.loading")}
      </div>
    ) : null}
    {definition && section === "identity" ? <IdentityEditor agent={agent} controller={controller} definition={definition} set_definition={set_definition} /> : null}
    {definition && section === "model" ? <ModelEditor definition={definition} controller={controller} set_definition={set_definition} /> : null}
    {definition && section === "soul" ? <SoulEditor definition={definition} controller={controller} set_definition={set_definition} /> : null}
    {error ? <div className="mx-2 mt-3 text-2xs leading-4 text-destructive">{error}</div> : null}
  </div>;
}


/**
 * 「某个 Agent 的配置」tab 的自解析内容。
 *
 * 只依赖 agent_id 与 controller，不接任何由页面持有的状态：
 * 这样切走 Agent 页之后，已打开的 tab 依旧能渲染出正确内容
 * （tab 与 MainView 不硬关联的关键就在这类组件）。
 */
export function AgentConfigTab({ agent_id, section, controller }: {
  /** 目标 Agent 标识。 */
  agent_id: string;
  /** 当前编辑分区。 */
  section: AgentEditorSection;
  /** Renderer 稳定控制器。 */
  controller: DesktopController;
}) {
  const translate_common = use_translation();
  const agent = use_desktop_selector(controller.stores.catalog, (state) => state.agents.find((item) => item.agent_id === agent_id));
  const definition_state = use_agent_definition(agent_id, controller);
  // Agent 可能已被删除：给一个明确的空态，而不是渲染一半或默默什么都不显示。
  if (!agent) return <div className="px-4 py-6 text-xs leading-5 text-muted-foreground">{translate_common("state.unavailable")}</div>;
  return <AgentEditorPanel agent={agent} controller={controller} section={section} {...definition_state} />;
}

/** 「某个 Agent 的配置」标签页的种类标识。 */
export const AGENT_TAB_KIND = "agent";

/**
 * 构造「某个 Agent 的配置」标签页。
 *
 * 在点击处调用，一次点击 = 一个标签页；内容自解析（只带 agent_id），
 * 所以切走 Agent 页后已打开的标签页依旧渲染正确内容。
 *
 * 标题用**这个 Agent 的名字**，而不是「编辑 Agent」这类固定文案：
 * 标签行上同时可能出现多个同类标签页，只有对象名能区分它们。
 */
export function agent_config_tab(agent: DesktopAgentSummary, controller: DesktopController, t: BayBarTranslate): BayBarTab {
  return {
    id: baybar_tab_id(AGENT_TAB_KIND, agent.agent_id),
    label: agent.name,
    icon: <AgentAvatar agent={agent} class_name="size-3.5 shrink-0" />,
    sections: AGENT_EDITOR_SECTIONS.map((item) => ({
      id: item.id,
      label: item.label_key ? t(item.label_key) : item.label ?? item.id,
      content: <AgentConfigTab agent_id={agent.agent_id} section={item.id} controller={controller} />,
    })),
  };
}

/** 编辑 Agent 的头像、用户可见名称与简介。 */
function IdentityEditor({ agent, controller, definition, set_definition }: { /** 当前 Agent 展示摘要。 */ agent: DesktopAgentSummary; /** Renderer 稳定控制器。 */ controller: DesktopController; /** 当前 Agent 定义。 */ definition: DesktopAgentDefinition; /** 替换未提交定义。 */ set_definition(value: DesktopAgentDefinition): void }) {
  const translate_resources = use_translation("resources");
  const [avatar_dialog_open, set_avatar_dialog_open] = useState(false);
  return <div className="flex flex-col gap-5 p-3">
    <div className="flex justify-center py-2">
      <button
        type="button"
        onClick={() => set_avatar_dialog_open(true)}
        className="rounded-avatar outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/30"
        title={translate_resources("agent_details.choose_avatar")}
        aria-label={translate_resources("agent_details.choose_avatar")}
      >
        <AgentAvatar agent={agent} class_name="size-24" icon_class_name="size-10" />
      </button>
    </div>
    <label className="flex flex-col gap-2">
      <span className="px-1 text-2xs font-medium text-muted-foreground">{translate_resources("agent.name")}</span>
      <input
        value={definition.name}
        className="h-10 w-full appearance-none rounded-control border-0 bg-control-surface px-3 text-base text-foreground outline-none transition-colors focus:bg-control-hover"
        onChange={(event) => set_definition({ ...definition, name: event.target.value })}
      />
    </label>
    <label className="flex flex-col gap-2">
      <span className="px-1 text-2xs font-medium text-muted-foreground">{translate_resources("agent.description")}</span>
      <textarea
        value={definition.description}
        rows={5}
        className="block min-h-28 w-full appearance-none resize-none rounded-control border-0 bg-control-surface px-3 py-2.5 text-base leading-5 text-foreground outline-none transition-colors focus:bg-control-hover"
        onChange={(event) => set_definition({ ...definition, description: event.target.value })}
      />
    </label>
    <Dialog open={avatar_dialog_open} onOpenChange={set_avatar_dialog_open}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{translate_resources("agent_details.avatar_title")}</DialogTitle>
          <DialogDescription>{translate_resources("agent_details.avatar_description", { name: agent.name })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex justify-center py-5">
            <AgentAvatar agent={agent} class_name="size-32" icon_class_name="size-14" />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button size="action" onClick={() => void controller.actions.generate_agent_avatar(definition.agent_id)}><TbRefresh />{translate_resources("agent_details.random")}</Button>
          <Button size="action" variant="primary" onClick={() => void controller.actions.choose_agent_avatar(definition.agent_id)}><TbPhoto />{translate_resources("agent_details.upload_image")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

/** 使用独立确认 Dialog 永久删除 Agent。 */
function DeleteAgentButton({ agent, controller }: { /** 当前 Agent。 */ agent: DesktopAgentSummary; /** Renderer 稳定控制器。 */ controller: DesktopController }) {
  const translate_common = use_translation("common");
  const translate_navigation = use_translation("navigation");
  const translate_resources = use_translation("resources");
  const [open, set_open] = useState(false);
  return <>
    <Button className="text-destructive" onClick={() => set_open(true)}><TbTrash />{translate_resources("agent.delete")}</Button>
    <ConfirmDialog
      open={open}
      set_open={set_open}
      title={translate_navigation("sidebar.delete_agent_title", { name: agent.name })}
      description={translate_navigation("sidebar.delete_agent_description")}
      confirm_label={translate_navigation("sidebar.permanent_delete")}
      pending_label={translate_navigation("sidebar.deleting")}
      cancel_label={translate_common("actions.cancel")}
      on_confirm={() => controller.actions.remove_agent(agent.agent_id)}
    >{translate_resources("agent_details.delete_blocked")}</ConfirmDialog>
  </>;
}

/** 默认模型编辑器。 */
function ModelEditor({
  definition,
  controller,
  set_definition,
}: {
  /** 未提交定义。 */ definition: DesktopAgentDefinition;
  /** Renderer 稳定控制器。 */ controller: DesktopController;
  /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void;
}) {
  const translate = use_translation("chat");
  const models = use_desktop_selector(controller.stores.catalog, (state) => state.models);
  const models_loading = use_desktop_selector(controller.stores.catalog, (state) => state.models_loading);
  const text_models = models.filter((model) =>
    model.modalities.some((modality) =>
      ["text", "stream", "openai"].includes(modality),
    ),
  );
  if (models_loading && text_models.length === 0)
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        {translate("model.loading")}
      </div>
    );
  if (text_models.length === 0)
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        {translate("model.empty")}
      </div>
    );
  return (
    <SettingGroup>
      {text_models.map((model) => {
        const active = model.model_id === definition.model_id;
        return (
          <SettingActionItem
            key={model.model_id}
            icon={
              <LLMModelIcon
                model_id={model.model_id}
                model_name={model.name}
                tags={model.tags}
                size_class="size-4"
              />
            }
            label={model.name}
            active={active}
            on_select={() =>
              set_definition({ ...definition, model_id: model.model_id })
            }
          />
        );
      })}
    </SettingGroup>
  );
}

/** Agent 主体指令编辑器。 */
function SoulEditor({
  definition,
  controller,
  set_definition,
}: {
  /** 未提交定义。 */ definition: DesktopAgentDefinition;
  /** Renderer 稳定控制器。 */ controller: DesktopController;
  /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void;
}) {
  const translate_resources = use_translation("resources");
  const editor_ref = useRef<HTMLDivElement>(null);
  const spellcheck_enabled = use_desktop_selector(controller.stores.settings, (state) => state.settings.spellcheck_enabled);
  useEffect(() => {
    const editor = editor_ref.current;
    if (editor && editor.innerText !== definition.instruction)
      editor.innerText = definition.instruction;
  }, [definition.instruction]);
  return (
    <div
      ref={editor_ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={translate_resources("agent_details.soul_label")}
      aria-multiline="true"
      autoFocus
      spellCheck={spellcheck_enabled}
      data-placeholder={translate_resources("agent_details.soul_placeholder")}
      className="h-full min-h-full w-full overflow-y-auto bg-transparent p-3 font-mono text-xs leading-6 text-foreground outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
      onInput={(event) =>
        set_definition({
          ...definition,
          instruction: event.currentTarget.innerText,
        })
      }
    />
  );
}


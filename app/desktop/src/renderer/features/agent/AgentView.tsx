/** Agent 身份、配置索引与 MainView 定义编辑内容。 */

import { useEffect, useRef, useState } from "react";
import { TbChevronRight, TbFileText, TbMessageCircle, TbPhoto, TbRefresh, TbTrash, TbUser } from "react-icons/tb";
import { Button } from "@/components/ui/button";
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

/** Agent 管理页属性。 */
interface AgentViewProps {
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** 当前 Agent 的主 Session。 */ main_session?: {
    workspace_id: string;
    session: DesktopSessionSummary;
  };
  /** Renderer 稳定控制器。 */ controller: DesktopController;
  /** 打开主 Session 对话。 */ open_main_session(): Promise<void>;
}

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
    icon: <AgentAvatar agent={agent} class_name="size-3.5 shrink-0 rounded-[0.25rem]" />,
    sections: AGENT_EDITOR_SECTIONS.map((item) => ({
      id: item.id,
      label: item.label_key ? t(item.label_key) : item.label ?? item.id,
      content: <AgentConfigTab agent_id={agent.agent_id} section={item.id} controller={controller} />,
    })),
  };
}

/** 左侧展示 Agent 摘要，点击配置项后在右侧展开对应编辑容器。 */
export function AgentView({
  agent,
  main_session,
  controller,
  open_main_session,
}: AgentViewProps) {
  const translate_resources = use_translation("resources");
  const translate_common = use_translation();
  // 右侧编辑面板由 MainView 提供；这里只需构造标签页并打开它。
  const open_baybar = use_baybar_open();
  const open_agent_tab = (section: AgentEditorSection) => open_baybar(agent_config_tab(agent, controller, translate_resources), section);
  const [avatar_dialog_open, set_avatar_dialog_open] = useState(false);
  const recent_sessions = main_session ? [main_session.session] : [];

  const content = (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <SettingsMainContent>
        <SettingsContainer>
          <button
            type="button"
            className="group flex w-fit min-w-0 items-center gap-4 rounded-2xl px-2 py-1 text-left outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/30"
            onClick={() => set_avatar_dialog_open(true)}
          >
            <AgentAvatar
              agent={agent}
              class_name="size-16 rounded-2xl"
              icon_class_name="size-8"
            />
            <span className="min-w-0">
              <span className="block truncate text-lg font-medium text-foreground">
                {agent.name}
              </span>
              <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                {translate_resources("agent_details.choose_avatar")}
                <TbChevronRight className="size-3.5" />
              </span>
            </span>
          </button>
          <SettingSection
            title="Agent"
            description={translate_resources("agent_details.agent_description")}
          >
            <SettingGroup>
              <SettingActionItem icon={<TbUser />} label={translate_resources("agent_details.identity")} description={agent.description || translate_resources("agent_details.identity_description")} trailing={<TbChevronRight />} on_select={() => open_agent_tab("identity")} />
              <SettingActionItem
                icon={<LLMModelIcon model_id={agent.model_id} />}
                label="Model"
                description={translate_resources("agent_details.model_description")}
                trailing={
                  <>
                    <span className="max-w-48 truncate">
                      {agent.model_id || translate_common("state.not_configured")}
                    </span>
                    <TbChevronRight />
                  </>
                }
                on_select={() => open_agent_tab("model")}
              />
              <SettingActionItem
                icon={<TbFileText />}
                label="SOUL.md"
                description={translate_resources("agent_details.soul_description")}
                trailing={<TbChevronRight />}
                on_select={() => open_agent_tab("soul")}
              />
            </SettingGroup>
          </SettingSection>
          <SettingSection title={translate_resources("agent_details.danger")} description={translate_resources("agent_details.danger_description")}><DeleteAgentButton agent={agent} controller={controller} /></SettingSection>
          <SettingSection title={translate_resources("agent_details.main_chat")} description={translate_resources("agent_details.main_chat_description")}>
            {recent_sessions.length > 0 ? (
              <SettingGroup>
                {recent_sessions.map((session) => (
                  <SettingActionItem
                    key={session.session_id}
                    icon={<TbMessageCircle />}
                    label={session.title || translate_resources("agent_details.main_chat")}
                    description={translate_resources("agent_details.messages", { count: session.message_count })}
                    trailing={<TbChevronRight />}
                    on_select={() => void open_main_session()}
                  />
                ))}
              </SettingGroup>
            ) : (
              <Button
                className="rounded-full px-3"
                onClick={() => void open_main_session()}
              >
                <TbMessageCircle />
                {translate_resources("agent_details.start_main_chat")}
              </Button>
            )}
          </SettingSection>
        </SettingsContainer>
      </SettingsMainContent>
      <Dialog open={avatar_dialog_open} onOpenChange={set_avatar_dialog_open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{translate_resources("agent_details.avatar_title")}</DialogTitle>
            <DialogDescription>
              {translate_resources("agent_details.avatar_description", { name: agent.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex justify-center py-4">
              <AgentAvatar
                agent={agent}
                class_name="size-28 rounded-3xl"
                icon_class_name="size-12"
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() =>
                void controller.actions.generate_agent_avatar(agent.agent_id)
              }
            >
              {translate_resources("agent_details.random")}
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                void controller.actions.choose_agent_avatar(agent.agent_id)
              }
            >
              {translate_resources("agent_details.upload_image")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
  return (
    <>
      <MainViewHeader
        title={
          <span className="flex min-w-0 items-center gap-1.5">
            <AgentAvatar agent={agent} />
            <span className="truncate">{agent.name}</span>
          </span>
        }
      />
      <MainViewBody>{content}</MainViewBody>
    </>
  );
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
        className="rounded-lg outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/30"
        title={translate_resources("agent_details.choose_avatar")}
        aria-label={translate_resources("agent_details.choose_avatar")}
      >
        <AgentAvatar agent={agent} class_name="size-24 rounded-lg" icon_class_name="size-10" />
      </button>
    </div>
    <label className="flex flex-col gap-2">
      <span className="px-1 text-2xs font-medium text-muted-foreground">{translate_resources("agent.name")}</span>
      <input
        value={definition.name}
        className="h-10 w-full appearance-none rounded-lg border-0 bg-control-surface px-3 text-base text-foreground outline-none transition-colors focus:bg-control-hover"
        onChange={(event) => set_definition({ ...definition, name: event.target.value })}
      />
    </label>
    <label className="flex flex-col gap-2">
      <span className="px-1 text-2xs font-medium text-muted-foreground">{translate_resources("agent.description")}</span>
      <textarea
        value={definition.description}
        rows={5}
        className="block min-h-28 w-full appearance-none resize-none rounded-lg border-0 bg-control-surface px-3 py-2.5 text-base leading-5 text-foreground outline-none transition-colors focus:bg-control-hover"
        onChange={(event) => set_definition({ ...definition, description: event.target.value })}
      />
    </label>
    <Dialog open={avatar_dialog_open} onOpenChange={set_avatar_dialog_open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{translate_resources("agent_details.avatar_title")}</DialogTitle>
          <DialogDescription>{translate_resources("agent_details.avatar_description", { name: agent.name })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex justify-center py-5">
            <AgentAvatar agent={agent} class_name="size-32 rounded-lg" icon_class_name="size-14" />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => void controller.actions.generate_agent_avatar(definition.agent_id)}><TbRefresh />{translate_resources("agent_details.random")}</Button>
          <Button variant="primary" onClick={() => void controller.actions.choose_agent_avatar(definition.agent_id)}><TbPhoto />{translate_resources("agent_details.upload_image")}</Button>
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
  const [removing, set_removing] = useState(false);
  const [error, set_error] = useState("");
  const remove_agent = async () => {
    set_removing(true);
    set_error("");
    try { await controller.actions.remove_agent(agent.agent_id); set_open(false); }
    catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
    finally { set_removing(false); }
  };
  return <><Button className="text-destructive" onClick={() => set_open(true)}><TbTrash />{translate_resources("agent.delete")}</Button><Dialog open={open} onOpenChange={(next_open) => { if (!removing) set_open(next_open); }}><DialogContent><DialogHeader><DialogTitle>{translate_navigation("sidebar.delete_agent_title", { name: agent.name })}</DialogTitle><DialogDescription>{translate_navigation("sidebar.delete_agent_description")}</DialogDescription></DialogHeader><DialogBody>{error ? <div className="text-xs text-destructive">{error}</div> : <div className="text-xs text-muted-foreground">{translate_resources("agent_details.delete_blocked")}</div>}</DialogBody><DialogFooter><Button disabled={removing} onClick={() => set_open(false)}>{translate_common("actions.cancel")}</Button><Button className="text-destructive" disabled={removing} onClick={() => void remove_agent()}>{translate_navigation(removing ? "sidebar.deleting" : "sidebar.permanent_delete")}</Button></DialogFooter></DialogContent></Dialog></>;
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


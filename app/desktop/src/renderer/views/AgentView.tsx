/** Agent 身份、配置索引与 MainView 定义编辑内容。 */

import { useEffect, useRef, useState } from "react";
import {
  TbChevronRight,
  TbComponents,
  TbFileText,
  TbMessageCircle,
  TbPhoto,
  TbPlus,
  TbRefresh,
  TbTrash,
  TbUser,
} from "react-icons/tb";
import { Button } from "@/components/ui/button";
import { DetailEditorSidebar } from "@/components/DetailEditorSidebar";
import { LLMModelIcon } from "@/components/model/LLMModelIcon";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  SettingActionItem,
  SettingGroup,
  SettingItem,
  SettingSection,
  SettingsContainer,
  SettingsMainContent,
} from "@/components/settings/SettingComponents";
import {
  MainViewBody,
  MainViewHeader,
  MainViewLayout,
} from "@/layouts/MainViewLayout";
import { ChatSurfaceLayout } from "@/layouts/ChatSurfaceLayout";
import { AgentAvatar } from "@/components/AgentAvatar";
import type { DesktopViewController } from "@/types/DesktopView";
import type {
  DesktopAgentDefinition,
  DesktopAgentSummary,
  DesktopPluginSummary,
  DesktopSessionSummary,
  DesktopWorkspaceSummary,
} from "@common/types/DesktopApi";

/** Agent 页面可以编辑的定义分区。 */
export type AgentEditorSection = "identity" | "model" | "soul" | "plugins";

/** Agent 管理页属性。 */
interface AgentViewProps {
  /** 当前 Agent。 */ agent: DesktopAgentSummary;
  /** 全部 Workspace。 */ workspaces: DesktopWorkspaceSummary[];
  /** 当前可用 Plugin。 */ plugins: DesktopPluginSummary[];
  /** 当前 Agent 的主 Session。 */ main_session?: {
    workspace_id: string;
    session: DesktopSessionSummary;
  };
  /** Renderer 根控制器。 */ controller: DesktopViewController;
  /** 打开主 Session 对话。 */ open_main_session(): Promise<void>;
  /** 打开 Agent 信息编辑面板。 */ open_config(
    section: AgentEditorSection,
  ): void;
  /** Agent Left Panel。 */ sidebar?: React.ReactNode;
  /** Agent Left Panel 是否折叠。 */ sidebar_collapsed?: boolean;
  /** 切换 Agent Left Panel。 */ toggle_sidebar?: () => void;
}
/** Agent 信息侧栏属性。 */
interface AgentInfoSidebarProps {
  /** 当前 Agent。 */
  agent: DesktopAgentSummary;
  /** 当前可用 Plugin。 */
  plugins: DesktopPluginSummary[];
  /** Renderer 根控制器。 */
  controller: DesktopViewController;
  /** 关闭信息侧栏。 */
  close_sidebar(): void;
  /** 当前配置分区。 */
  section?: AgentEditorSection;
  /** 是否折叠侧栏。 */
  collapsed?: boolean;
  /** 是否嵌入 BayBar。 */
  embedded?: boolean;
}

/** 当前 Agent 配置项的单一编辑器。 */
export function AgentInfoSidebar({
  agent,
  plugins,
  controller,
  close_sidebar,
  section,
  collapsed = false,
  embedded = false,
}: AgentInfoSidebarProps) {
  const [editor_section, set_editor_section] = useState<
    AgentEditorSection | undefined
  >(section || "model");
  useEffect(() => {
    if (section) set_editor_section(section);
  }, [section]);
  const [definition, set_definition] = useState<DesktopAgentDefinition>();
  const [loading_definition, set_loading_definition] = useState(false);
  const [definition_dirty, set_definition_dirty] = useState(false);
  const [editor_error, set_editor_error] = useState("");
  const definition_version_ref = useRef(0);
  const load_definition = async () => {
    set_loading_definition(true);
    set_editor_error("");
    try {
      set_definition(await controller.get_agent(agent.agent_id));
    } catch (reason) {
      set_editor_error(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      set_loading_definition(false);
    }
  };
  useEffect(() => {
    let disposed = false;
    set_definition(undefined);
    set_definition_dirty(false);
    set_editor_error("");
    set_loading_definition(true);
    void controller.get_agent(agent.agent_id).then((next_definition) => {
      if (!disposed) set_definition(next_definition);
    }).catch((reason) => {
      if (!disposed) set_editor_error(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!disposed) set_loading_definition(false);
    });
    return () => { disposed = true; };
  }, [agent.agent_id, controller.get_agent]);
  const update_definition = (value: DesktopAgentDefinition) => {
    definition_version_ref.current += 1;
    set_definition(value);
    set_definition_dirty(true);
  };
  useEffect(() => {
    if (!definition_dirty || !definition) return;
    const version = definition_version_ref.current;
    const timeout_id = window.setTimeout(() => {
      const plugins_input = Object.fromEntries(
        Object.entries(definition.plugins).map(([plugin_id, reference]) => [
          plugin_id,
          reference.profile ? { profile: reference.profile.trim() } : {},
        ]),
      );
      void controller
        .update_agent(agent.agent_id, {
          name: definition.name,
          description: definition.description,
          model_id: definition.model_id,
          instruction: definition.instruction,
          plugins: plugins_input,
        })
        .then(() => {
          if (definition_version_ref.current === version)
            set_definition_dirty(false);
        })
        .catch((reason) =>
          set_editor_error(
            reason instanceof Error ? reason.message : String(reason),
          ),
        );
    }, 500);
    return () => window.clearTimeout(timeout_id);
  }, [agent.agent_id, controller.update_agent, definition, definition_dirty]);
  const titles: Record<AgentEditorSection, string> = {
    identity: "身份",
    model: "Model",
    soul: "SOUL.md",
    plugins: "Plugins",
  };
  const content = editor_section ? (
    <AgentEditorPanel
      embedded
      agent={agent}
      section={editor_section}
      definition={definition}
      plugins={plugins}
      controller={controller}
      loading={loading_definition}
      error={editor_error}
      set_definition={update_definition}
      close_editor={close_sidebar}
    />
  ) : null;
  if (embedded) return content;
  return (
    <DetailEditorSidebar
      title={`${agent.name} / ${titles[editor_section || "model"]}`}
      storage_key="downcity.agent_config_width"
      default_width={400}
      max_width={560}
      on_close={close_sidebar}
      collapsed={collapsed}
      show_close={false}
      embedded={embedded}
    >
      {content}
    </DetailEditorSidebar>
  );
}

/** 左侧展示 Agent 摘要，点击配置项后在右侧展开对应编辑容器。 */
export function AgentView({
  agent,
  workspaces,
  plugins,
  main_session,
  controller,
  open_main_session,
  open_config,
  sidebar,
  sidebar_collapsed = false,
  toggle_sidebar,
}: AgentViewProps) {
  const [avatar_dialog_open, set_avatar_dialog_open] = useState(false);
  const bound_plugins = plugins.filter((plugin) =>
    plugin.agent_ids.includes(agent.agent_id),
  );
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
              <span className="block truncate text-base font-medium text-foreground">
                {agent.name}
              </span>
              <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                配置头像
                <TbChevronRight className="size-3.5" />
              </span>
            </span>
          </button>
          <SettingSection
            title="Agent"
            description="配置 Agent 的默认能力与行为"
          >
            <SettingGroup>
              <SettingActionItem icon={<TbUser />} label="身份" description={agent.description || "配置名称和简介"} trailing={<TbChevronRight />} on_select={() => open_config("identity")} />
              <SettingActionItem
                icon={<LLMModelIcon model_id={agent.model_id} />}
                label="Model"
                description="Agent 默认使用的文本模型"
                trailing={
                  <>
                    <span className="max-w-48 truncate">
                      {agent.model_id || "未配置"}
                    </span>
                    <TbChevronRight />
                  </>
                }
                on_select={() => open_config("model")}
              />
              <SettingActionItem
                icon={<TbFileText />}
                label="SOUL.md"
                description="定义 Agent 的身份、目标和行为方式"
                trailing={<TbChevronRight />}
                on_select={() => open_config("soul")}
              />
              <SettingActionItem
                icon={<TbComponents />}
                label="Plugins"
                description="启用工具、渠道与外部能力"
                trailing={
                  <>
                    <span>{bound_plugins.length} 个</span>
                    <TbChevronRight />
                  </>
                }
                on_select={() => open_config("plugins")}
              />
            </SettingGroup>
          </SettingSection>
          <SettingSection title="危险操作" description="永久删除这个 Agent 及其数据"><DeleteAgentButton agent={agent} controller={controller} /></SettingSection>
          <SettingSection title="主对话" description="进入该 Agent 的持续对话">
            {recent_sessions.length > 0 ? (
              <SettingGroup>
                {recent_sessions.map((session) => (
                  <SettingActionItem
                    key={session.session_id}
                    icon={<TbMessageCircle />}
                    label={session.title || "主对话"}
                    description={`${session.message_count} 条消息`}
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
                开始主对话
              </Button>
            )}
          </SettingSection>
        </SettingsContainer>
      </SettingsMainContent>
      <Dialog open={avatar_dialog_open} onOpenChange={set_avatar_dialog_open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配置头像</DialogTitle>
            <DialogDescription>
              设置 {agent.name} 在 Chat 和 Group 中显示的头像。
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
                void controller.generate_agent_avatar(agent.agent_id)
              }
            >
              随机头像
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                void controller.choose_agent_avatar(agent.agent_id)
              }
            >
              选择图片
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
  if (sidebar && toggle_sidebar)
    return (
      <ChatSurfaceLayout
        sidebar={sidebar}
        header_left={agent.name}
      >
        {content}
      </ChatSurfaceLayout>
    );
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-background">
      <MainViewLayout>
        <MainViewHeader
          title={
            <span className="flex min-w-0 items-center gap-1.5">
              <AgentAvatar agent={agent} />
              <span className="truncate">{agent.name}</span>
            </span>
          }
        />
        <MainViewBody>{content}</MainViewBody>
      </MainViewLayout>
    </div>
  );
}

/** Agent 页面右侧的分区编辑容器。 */
function AgentEditorPanel({
  agent,
  section,
  definition,
  plugins,
  controller,
  loading,
  error,
  set_definition,
  close_editor,
  embedded = false,
}: {
  /** 当前 Agent 展示摘要。 */ agent: DesktopAgentSummary;
  /** 当前编辑分区。 */ section: AgentEditorSection;
  /** 当前未提交定义。 */ definition?: DesktopAgentDefinition;
  /** 可注册的全部 Plugin。 */ plugins: DesktopPluginSummary[];
  /** Renderer 根控制器。 */ controller: DesktopViewController;
  /** 是否正在读取定义。 */ loading: boolean;
  /** 当前编辑错误。 */ error: string;
  /** 替换未提交定义。 */ set_definition(value: DesktopAgentDefinition): void;
  /** 收起右侧容器。 */ close_editor(): void;
  /** 是否嵌入已有信息侧栏。 */ embedded?: boolean;
}) {
  const content = (
    <>
      {loading && !definition ? (
        <div className="py-10 text-center text-xs text-muted-foreground">
          加载中…
        </div>
      ) : null}
      {definition && section === "model" ? (
        <ModelEditor
          definition={definition}
          controller={controller}
          set_definition={set_definition}
        />
      ) : null}
      {definition && section === "identity" ? <IdentityEditor agent={agent} controller={controller} definition={definition} set_definition={set_definition} /> : null}
      {definition && section === "soul" ? (
        <SoulEditor
          definition={definition}
          controller={controller}
          set_definition={set_definition}
        />
      ) : null}
      {definition && section === "plugins" ? (
        <PluginEditor
          definition={definition}
          plugins={plugins}
          controller={controller}
          set_definition={set_definition}
        />
      ) : null}
      {error ? (
        <div className="mt-3 text-[0.6875rem] leading-4 text-destructive">
          {error}
        </div>
      ) : null}
    </>
  );
  if (embedded)
    return (
      <div
        className={`h-full min-h-0 w-full ${section === "soul" ? "" : "p-2"}`}
      >
        {content}
      </div>
    );
  const titles: Record<AgentEditorSection, string> = {
    identity: "身份",
    model: "Model",
    soul: "SOUL.md",
    plugins: "Plugins",
  };
  return (
    <DetailEditorSidebar
      title={titles[section]}
      storage_key="downcity.agent_editor_width"
      default_width={400}
      max_width={560}
      on_close={close_editor}
    >
      {content}
    </DetailEditorSidebar>
  );
}

/** 编辑 Agent 的头像、用户可见名称与简介。 */
function IdentityEditor({ agent, controller, definition, set_definition }: { /** 当前 Agent 展示摘要。 */ agent: DesktopAgentSummary; /** Renderer 根控制器。 */ controller: DesktopViewController; /** 当前 Agent 定义。 */ definition: DesktopAgentDefinition; /** 替换未提交定义。 */ set_definition(value: DesktopAgentDefinition): void }) {
  return <div className="flex flex-col gap-5 p-3">
    <div className="flex flex-col items-center gap-2.5 py-2">
      <button type="button" onClick={() => void controller.choose_agent_avatar(definition.agent_id)} className="rounded-2xl transition-opacity duration-150 hover:opacity-80" title="选择头像图片">
        <AgentAvatar agent={agent} class_name="size-16 rounded-2xl" icon_class_name="size-8" />
      </button>
      <div className="flex items-center gap-1">
        <Button className="h-7 gap-1 px-2 text-[0.6875rem]" onClick={() => void controller.generate_agent_avatar(definition.agent_id)}><TbRefresh />随机</Button>
        <Button className="h-7 gap-1 px-2 text-[0.6875rem]" onClick={() => void controller.choose_agent_avatar(definition.agent_id)}><TbPhoto />选择图片</Button>
      </div>
    </div>
    <label className="flex flex-col gap-1.5"><span className="text-xs text-muted-foreground">名称</span><input value={definition.name} className="h-9 rounded-lg border border-input bg-background px-3 text-sm" onChange={(event) => set_definition({ ...definition, name: event.target.value })} /></label>
    <label className="flex flex-col gap-1.5"><span className="text-xs text-muted-foreground">简介</span><textarea value={definition.description} rows={5} className="resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-5" onChange={(event) => set_definition({ ...definition, description: event.target.value })} /></label>
  </div>;
}

/** 使用独立确认 Dialog 永久删除 Agent。 */
function DeleteAgentButton({ agent, controller }: { /** 当前 Agent。 */ agent: DesktopAgentSummary; /** Renderer 根控制器。 */ controller: DesktopViewController }) {
  const [open, set_open] = useState(false);
  const [removing, set_removing] = useState(false);
  const [error, set_error] = useState("");
  const remove_agent = async () => {
    set_removing(true);
    set_error("");
    try { await controller.remove_agent(agent.agent_id); set_open(false); }
    catch (reason) { set_error(reason instanceof Error ? reason.message : String(reason)); }
    finally { set_removing(false); }
  };
  return <><Button className="text-destructive" onClick={() => set_open(true)}><TbTrash />删除 Agent</Button><Dialog open={open} onOpenChange={(next_open) => { if (!removing) set_open(next_open); }}><DialogContent><DialogHeader><DialogTitle>永久删除 {agent.name}？</DialogTitle><DialogDescription>此操作无法撤销。Session、日志、Schedule、头像和 Plugin 数据都会被删除。</DialogDescription></DialogHeader><DialogBody>{error ? <div className="text-xs text-destructive">{error}</div> : <div className="text-xs text-muted-foreground">正在执行任务或仍属于 Group 时无法删除。</div>}</DialogBody><DialogFooter><Button disabled={removing} onClick={() => set_open(false)}>取消</Button><Button className="text-destructive" disabled={removing} onClick={() => void remove_agent()}>{removing ? "删除中…" : "永久删除"}</Button></DialogFooter></DialogContent></Dialog></>;
}

/** 默认模型编辑器。 */
function ModelEditor({
  definition,
  controller,
  set_definition,
}: {
  /** 未提交定义。 */ definition: DesktopAgentDefinition;
  /** Renderer 根控制器。 */ controller: DesktopViewController;
  /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void;
}) {
  const text_models = controller.models.filter((model) =>
    model.modalities.some((modality) =>
      ["text", "stream", "openai"].includes(modality),
    ),
  );
  if (controller.models_loading && text_models.length === 0)
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        模型加载中…
      </div>
    );
  if (text_models.length === 0)
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        暂无文本模型
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
  /** Renderer 根控制器。 */ controller: DesktopViewController;
  /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void;
}) {
  const editor_ref = useRef<HTMLDivElement>(null);
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
      aria-label="SOUL.md 内容"
      aria-multiline="true"
      autoFocus
      spellCheck={controller.settings.spellcheck_enabled}
      data-placeholder="开始编辑 SOUL.md…"
      className="h-full min-h-full w-full overflow-y-auto bg-transparent p-3 font-mono text-xs leading-6 text-foreground outline-none empty:before:pointer-events-none empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]"
      onInput={(event) =>
        set_definition({
          ...definition,
          instruction: event.currentTarget.innerText,
        })
      }
    />
  );
}

/** Plugin 注册与 profile 编辑器。 */
function PluginEditor({
  definition,
  plugins,
  controller,
  set_definition,
}: {
  /** 未提交定义。 */ definition: DesktopAgentDefinition;
  /** 可用 Plugin。 */ plugins: DesktopPluginSummary[];
  /** Desktop 根控制器。 */ controller: DesktopViewController;
  /** 替换定义。 */ set_definition(value: DesktopAgentDefinition): void;
}) {
  const [missing_profile_plugin, set_missing_profile_plugin] =
    useState<DesktopPluginSummary>();
  const [missing_profile_dialog_open, set_missing_profile_dialog_open] =
    useState(false);
  const [pending_profile_plugin_id, set_pending_profile_plugin_id] =
    useState<string>();
  const open_missing_profile_dialog = (plugin: DesktopPluginSummary) => {
    set_missing_profile_plugin(plugin);
    set_missing_profile_dialog_open(true);
  };
  const complete_missing_profile_dialog = (open: boolean) => {
    if (open) return;
    const plugin_id = pending_profile_plugin_id;
    set_missing_profile_plugin(undefined);
    set_pending_profile_plugin_id(undefined);
    if (plugin_id) controller.select_plugin(plugin_id);
  };
  const set_plugin = (plugin: DesktopPluginSummary, enabled: boolean) => {
    const next_plugins = { ...definition.plugins };
    if (!enabled) {
      delete next_plugins[plugin.plugin_id];
    } else {
      next_plugins[plugin.plugin_id] = {};
    }
    set_definition({ ...definition, plugins: next_plugins });
  };
  const set_profile = (plugin_id: string, profile: string) =>
    set_definition({
      ...definition,
      plugins: {
        ...definition.plugins,
        [plugin_id]: profile ? { profile } : {},
      },
    });
  return (
    <>
      <SettingGroup>
        {plugins
          .filter((plugin) => plugin.has_main)
          .map((plugin) => {
            const reference = definition.plugins[plugin.plugin_id];
            const profile_options = [
              { value: "", label: "空配置" },
              ...plugin.profile_ids.map((profile_id) => ({
                value: profile_id,
                label: profile_id,
              })),
            ];
            return (
              <SettingItem
                key={plugin.plugin_id}
                label={plugin.title}
                leading={<TbComponents />}
              >
                <div className="flex items-center gap-2">
                  {reference && plugin.has_config ? (
                    plugin.profile_ids.length > 0 ? (
                      <Select
                        value={reference.profile || ""}
                        options={profile_options}
                        on_value_change={(profile) =>
                          set_profile(plugin.plugin_id, profile)
                        }
                        className="min-w-28 max-w-44 rounded-full"
                        align="end"
                      />
                    ) : (
                      <Button
                        className="rounded-full"
                        onClick={() => open_missing_profile_dialog(plugin)}
                      >
                        <TbPlus />
                        Profile
                      </Button>
                    )
                  ) : null}
                  <Switch
                    checked={Boolean(reference)}
                    onCheckedChange={(enabled) => set_plugin(plugin, enabled)}
                    aria-label={`${plugin.title} 启用状态`}
                  />
                </div>
              </SettingItem>
            );
          })}
        {plugins.every((plugin) => !plugin.has_main) ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            暂无可用 Plugin
          </div>
        ) : null}
      </SettingGroup>
      <Dialog
        open={missing_profile_dialog_open}
        onOpenChange={set_missing_profile_dialog_open}
        onOpenChangeComplete={complete_missing_profile_dialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              为 {missing_profile_plugin?.title} 添加配置
            </DialogTitle>
            <DialogDescription>
              创建一个命名 Profile 后，Agent 可以显式选择它。
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              创建完成后返回当前 Agent 页面，再展开 Plugin 选择刚刚创建的
              Profile。
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => set_missing_profile_dialog_open(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                set_pending_profile_plugin_id(
                  missing_profile_plugin?.plugin_id,
                );
                set_missing_profile_dialog_open(false);
              }}
            >
              去创建配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

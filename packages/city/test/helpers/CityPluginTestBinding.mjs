/**
 * Agent 集成测试使用的 City Plugin 注册辅助函数。
 *
 * 测试通过真实 City 注册协议装配 Plugin，避免重新引入已删除的 raw Plugin 兼容入口。
 */

/** 把一个测试 Plugin 实例包装成 City 可解释的统一注册。 */
export function create_plugin_registration(plugin) {
  return {
    id: plugin.name,
    title: plugin.title || plugin.name,
    description: plugin.description || "Test Plugin",
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    module: {
      activate() {},
      create: () => plugin,
    },
  };
}

/** 每个测试 City 中按 Plugin ID 复用的可替换 factory。 */
const registrations_by_city = new WeakMap();

/** 向 City 登记测试 Plugin，并创建使用 default Profile 的 Agent 绑定。 */
export function create_plugin_binding(city, plugin) {
  let registrations = registrations_by_city.get(city);
  if (!registrations) {
    registrations = new Map();
    registrations_by_city.set(city, registrations);
  }
  let record = registrations.get(plugin.name);
  if (!record) {
    record = { plugin };
    const registration = create_plugin_registration(plugin);
    registration.module.create = () => record.plugin;
    registrations.set(plugin.name, record);
    city.plugins.provide(registration);
  } else {
    record.plugin = plugin;
  }
  return { plugin_id: plugin.name };
}

/** 创建内部 Registry 单元测试使用的完整 PluginContext。 */
export function create_test_plugin_context(options = {}) {
  const workspace_path = options.workspace_path || process.cwd();
  const data_path = options.data_path || workspace_path;
  const session_runtime = (session_id, origin_type = "chat") => ({
    id: session_id,
    origin: { type: origin_type },
    prompt: async () => ({
      id: "test_turn",
      result: null,
      finished: Promise.resolve({ turn_id: "test_turn", text: "", success: true }),
    }),
    stop: async () => ({}),
    subscribe: () => () => {},
    context: async () => ({ messages: [] }),
    append_assistant_message: async () => {},
  });
  const plugins = {
    get: () => null,
    snapshots: () => [],
    run_action: async () => ({ success: false, error: "not available" }),
    pipeline: async (_point_name, value) => value,
    effect: async () => {},
  };
  return {
    city: {
      ...(options.embassy ? { embassy: options.embassy } : {}),
      plugins,
    },
    agent: {
      id: options.agent_id || "test_agent",
      name: options.agent_id || "test_agent",
      description: "",
      instructions: [],
      sessions: {
        create: async () => session_runtime("created_session"),
        get: async (session_id, origin_type) => session_runtime(session_id, origin_type),
        runtime: session_runtime,
        remove: async () => false,
      },
    },
    workspace: {
      id: options.workspace_id || "test_workspace",
      path: workspace_path,
      files: options.files || {},
      env: {},
    },
    profile: { id: "default", config: {} },
    storage: { path: data_path, files: options.data_files || {} },
    logger: {
      log: async () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    abort_signal: new AbortController().signal,
  };
}

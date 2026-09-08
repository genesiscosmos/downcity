/**
 * Agent 集成测试使用的 City Plugin 注册辅助函数。
 *
 * 测试通过真实 City 注册协议装配 Plugin，避免重新引入已删除的 raw Plugin 兼容入口。
 */

/** 把一个测试 Plugin 实例包装成 City 可解释的统一注册。 */
export function create_plugin_registration(plugin) {
  return {
    readme: import.meta.filename,
    has_config: false,
    has_sidebar: false,
    has_mainview: false,
    plugin,
  };
}

/** 用类语义创建无隐藏生命周期的测试 Plugin。 */
export function create_test_plugin(definition) {
  const { lifecycle, ...plugin } = definition;
  return Object.assign({
    title: definition.name,
    description: "Test Plugin",
    actions: {},
  }, plugin, lifecycle || {});
}

/** 向 City 登记测试 Plugin。 */
export function add_test_plugin(city, plugin) {
  city.plugins.add(create_plugin_registration(plugin));
  return plugin;
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
    append_agent_message: async () => {},
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
    config: {},
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

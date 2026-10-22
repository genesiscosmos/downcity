/** Session Turn 普通输入的来源对象；身份由可信宿主绑定。 */
export type SessionPromptActor =
  | {
      /** 直接用户输入。 */
      kind: "user";
      /** 稳定用户标识，与窗口和聊天路由无关。 */
      user_id: string;
    }
  | {
      /** 来源 Session；来源 Turn 不参与对象比较。 */
      kind: "session";
      /** 来源 Agent 标识。 */
      agent_id: string;
      /** 来源 Workspace，无工作区时为 null。 */
      workspace_id: string | null;
      /** 来源 Session 标识。 */
      session_id: string;
      /** 来源 Session 分类；Session 身份由分类与标识共同组成。 */
      category: string;
    }
  | {
      /** 宿主自动执行对象，不冒用用户或 Session。 */
      kind: "runtime";
      /** 执行领域，例如 task、group。 */
      namespace: string;
      /** 允许持续注入的稳定执行对象标识。 */
      object_id: string;
    };

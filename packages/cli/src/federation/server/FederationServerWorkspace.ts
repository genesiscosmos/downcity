/**
 * 已部署 Federation admin 工作区入口。
 *
 * 关键说明（中文）
 * - 用户从 downfed 选择一个已部署 Federation 后，直接进入 adminLoop。
 * - 如果本地记录缺少有效管理员 Session，则要求管理员 ID 与密码登录。
 * - 编辑、移除、更新 admin 访问等低频动作挂在 adminLoop 的“更多”里。
 */

import { adminLoop } from "@/federation/admin/loop.js";
import { adminAuth, login_federation_admin } from "@/federation/auth/admin.js";
import { isAdminAuthError } from "@/federation/admin/auth-error.js";
import {
  readActiveServer,
  readServer,
  removeServer,
  setActiveServer,
  updateServer,
  type ServerProfile,
} from "@/federation/core/session.js";
import { create_admin_tui_runtime } from "@/federation/tui/AdminTuiRuntime.js";
import type { admin_tui_runtime } from "@/federation/types/AdminTui.js";
import { t } from "@/shared/CliLocale.js";
import { stop_managed_local_server } from "@/federation/deploy/runtime/LocalFederationDeployer.js";

/**
 * 打开某个 Federation 的 admin 工作区。
 */
export async function open_federation_server_workspace(
  base_url: string,
): Promise<"home" | "quit"> {
  let current_base_url = base_url;

  while (true) {
    const server = readServer(current_base_url);
    if (!server) {
      return "home";
    }

    setActiveServer(server.base_url);

    const runtime = create_admin_tui_runtime(`${server.name} - Admin`);
    const session = await resolve_admin_session(server.base_url, runtime);
    if (!session) {
      runtime.close();
      return "home";
    }

    let should_reload_workspace = false;

    try {
      const result = await adminLoop(session, {
        embedded: true,
        title: `${server.name} - Admin`,
        runtime,
        on_more: async (more_runtime) => {
          const more_result = await open_federation_admin_more_actions(
            current_base_url,
            more_runtime,
          );
          if (more_result.kind === "updated") {
            current_base_url = more_result.base_url;
            should_reload_workspace = true;
            return "back";
          }
          return more_result.kind;
        },
      });

      if (result === "quit") {
        return "quit";
      }
      if (result === "logout") {
        const updated_server = await configure_admin_access_inline(current_base_url, runtime);
        if (!updated_server) {
          runtime.close();
          return "home";
        }
        current_base_url = updated_server.base_url;
        continue;
      }
      if (should_reload_workspace) {
        continue;
      }
      return "home";
    } catch (error) {
      if (!isAdminAuthError(error)) {
        throw error;
      }

      await runtime.show_message("error", t({
        zh: "管理员会话已失效，请重新登录。",
        en: "Administrator session expired. Please log in again.",
      }));
      const updated_server = await configure_admin_access_inline(current_base_url, runtime);
      if (!updated_server) {
        runtime.close();
        return "home";
      }
      current_base_url = updated_server.base_url;
    }
  }
}

async function resolve_admin_session(
  base_url: string,
  runtime: admin_tui_runtime,
) {
  let server = readServer(base_url);
  if (!server) {
    return undefined;
  }

  const has_valid_session = Boolean(
    server.admin_session_token?.trim()
    && server.admin_session_expires_at
    && Date.parse(server.admin_session_expires_at) > Date.now(),
  );
  if (!has_valid_session) {
    const updated_server = await configure_admin_access_inline(server.base_url, runtime);
    if (!updated_server) {
      return undefined;
    }
    server = updated_server;
  }

  return await adminAuth(server);
}

async function configure_admin_access_inline(
  base_url: string,
  runtime: admin_tui_runtime,
): Promise<ServerProfile | undefined> {
  const server = readServer(base_url);
  if (!server) {
    await runtime.show_message("error", t({
      zh: "所选 Federation 已不存在。",
      en: "Selected Federation no longer exists.",
    }));
    return undefined;
  }

  const admin_id = await runtime.text(t({ zh: "管理员 ID", en: "Administrator ID" }), server.admin_id);
  if (!admin_id?.trim()) return undefined;
  const password = await runtime.password(t({ zh: "管理员密码", en: "Administrator password" }));
  if (!password) {
    return undefined;
  }
  let session;
  try {
    session = await login_federation_admin({
      base_url: server.base_url,
      admin_id,
      password,
    });
  } catch (error) {
    await runtime.show_message("error", error instanceof Error ? error.message : String(error));
    return undefined;
  }
  const updated_server = updateServer(server.base_url, {
    ...server,
    admin_id: session.admin_id,
    admin_session_token: session.session_token,
    admin_session_expires_at: session.expires_at,
  });
  await runtime.show_message("success", t({
    zh: `Admin 访问已配置：${updated_server.name}`,
    en: `Admin access configured: ${updated_server.name}`,
  }));
  return updated_server;
}

async function open_federation_admin_more_actions(
  base_url: string,
  runtime: admin_tui_runtime,
): Promise<
  | { kind: "continue" }
  | { kind: "back" }
  | { kind: "quit" }
  | { kind: "removed" }
  | { kind: "updated"; base_url: string }
> {
  const server = readServer(base_url);
  if (!server) {
    return { kind: "removed" };
  }

  const selected = await runtime.select(
    t({
      zh: `${server.name} - 更多`,
      en: `${server.name} - More`,
    }),
    [
      {
        label: t({ zh: "管理员重新登录", en: "Administrator login" }),
        value: "update_admin",
        hint: t({
          zh: "使用管理员 ID 和密码创建新会话",
          en: "Create a new session with administrator ID and password",
        }),
      },
      {
        label: t({ zh: "编辑 Federation", en: "Edit Federation" }),
        value: "edit_federation",
        hint: t({
          zh: `修改当前 Federation 的本地名称或 URL：${server.base_url}`,
          en: `Edit the local name or URL for this Federation: ${server.base_url}`,
        }),
      },
      {
        label: t({ zh: "移除 Federation", en: "Remove Federation" }),
        value: "remove_federation",
        hint: t({
          zh: "删除这条本地连接记录",
          en: "Delete this local connection",
        }),
      },
      {
        label: t({ zh: "导航", en: "Navigation" }),
        value: "__section_navigation__",
        disabled: true,
      },
      {
        label: t({ zh: "返回", en: "Back" }),
        value: "back",
        hint: t({
          zh: "返回 Admin 管理菜单",
          en: "Return to Admin management",
        }),
      },
      {
        label: t({ zh: "退出", en: "Exit" }),
        value: "quit",
        hint: t({
          zh: "退出 downfed",
          en: "Exit downfed",
        }),
      },
    ],
  );

  if (!selected || selected === "back") {
    return { kind: "continue" };
  }
  if (selected === "quit") {
    return { kind: "quit" };
  }
  if (selected === "update_admin") {
    const updated_server = await configure_admin_access_inline(base_url, runtime);
    if (!updated_server) return { kind: "continue" };
    return { kind: "updated", base_url: updated_server.base_url };
  }
  if (selected === "edit_federation") {
    const field = await runtime.select(
      t({
        zh: `编辑 ${server.name}`,
        en: `Edit ${server.name}`,
      }),
      [
        {
          label: t({ zh: "名称", en: "Name" }),
          value: "name",
          hint: server.name,
        },
        {
          label: t({ zh: "Federation URL", en: "Federation URL" }),
          value: "base_url",
          hint: server.base_url,
        },
        {
          label: t({ zh: "取消", en: "Cancel" }),
          value: "cancel",
        },
      ],
    );
    if (!field || field === "cancel") {
      return { kind: "continue" };
    }

    const next = { ...server };
    if (field === "name") {
      const name = await runtime.text(t({ zh: "显示名称", en: "Display name" }), server.name);
      if (!name?.trim()) {
        return { kind: "continue" };
      }
      next.name = name.trim();
    }
    if (field === "base_url") {
      const next_base_url = await runtime.text("Federation URL", server.base_url);
      if (!next_base_url?.trim()) {
        return { kind: "continue" };
      }
      next.base_url = next_base_url.trim();
    }

    const updated_server = updateServer(server.base_url, next);
    await runtime.show_message("success", t({
      zh: `Federation 已更新：${updated_server.name}`,
      en: `Federation updated: ${updated_server.name}`,
    }));
    return { kind: "updated", base_url: updated_server.base_url };
  }
  if (selected === "remove_federation") {
    const confirmed = await runtime.select(
      t({
        zh: `移除 ${server.name}?`,
        en: `Remove ${server.name}?`,
      }),
      [
        {
          label: t({ zh: "确认移除", en: "Remove" }),
          value: "remove",
          hint: server.base_url,
        },
        {
          label: t({ zh: "取消", en: "Cancel" }),
          value: "cancel",
        },
      ],
    );
    if (confirmed !== "remove") {
      return { kind: "continue" };
    }
    if (server.target === "local") {
      await stop_managed_local_server(server);
    }
    removeServer(base_url);
    const next_active = readActiveServer();
    await runtime.show_message(
      "success",
      next_active
        ? t({
          zh: `Federation 已移除。当前 Federation：${next_active.name}`,
          en: `Federation removed. Current Federation: ${next_active.name}`,
        })
        : t({
          zh: "Federation 已移除。当前没有已配置的 Federation。",
          en: "Federation removed. No Federation configured.",
        }),
    );
    return { kind: "removed" };
  }

  return { kind: "continue" };
}

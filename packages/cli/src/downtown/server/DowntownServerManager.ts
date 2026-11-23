/**
 * 已部署 Downtown 本地连接管理模块。
 *
 * 关键说明（中文）
 * - downtown 需要管理已经部署好的 Downtown，而不只是 create / deploy。
 * - 本模块负责添加、选择、编辑、移除本地保存的 Downtown 连接。
 * - 管理员密码只用于登录，registry 仅保存有期限 Session Token。
 */

import { isCancel, password, select, text } from "@/downtown/tui/Prompts.js";
import { login_downtown_admin } from "@/downtown/auth/admin.js";
import {
  addServer,
  readConfig,
  readServer,
  removeServer,
  type ServerProfile,
  updateServer,
} from "@/downtown/core/session.js";
import { showError, showSuccess } from "@/downtown/core/ui.js";
import { t } from "@/shared/CliLocale.js";

const DOWNTOWN_URL_EXAMPLE = "https://your-downtown.example.com";

/**
 * 添加一个已部署 Downtown 连接记录，并返回该对象。
 */
export async function prompt_add_downtown_server(): Promise<ServerProfile | undefined> {
  const base_url = await text({
    message: t({
      zh: "Downtown URL",
      en: "Downtown URL",
    }),
    placeholder: DOWNTOWN_URL_EXAMPLE,
  });
  if (!base_url || isCancel(base_url) || !String(base_url).trim()) {
    return undefined;
  }

  const server = addServer({
    base_url: String(base_url).trim(),
  });

  const verified = await verify_downtown_public_access(server);
  if (verified) {
    showSuccess(t({
      zh: `Downtown 已连接：${server.name}`,
      en: `Downtown connected: ${server.name}`,
    }));
  } else {
    showError(t({
      zh: `Downtown 已保存，但公共可达性检查失败：${server.name}`,
      en: `Downtown saved, but the public reachability check failed: ${server.name}`,
    }));
  }

  return server;
}

/**
 * 编辑已保存的 Downtown 连接。
 */
export async function prompt_edit_downtown_server(
  base_url?: string,
): Promise<ServerProfile | undefined> {
  const config = readConfig();
  if (config.servers.length === 0) {
    showError(t({
      zh: "当前没有已配置的 Downtown。",
      en: "No Downtowns configured.",
    }));
    return undefined;
  }

  const target_base_url = base_url ?? await select({
    message: t({
      zh: "编辑 Downtown",
      en: "Edit Downtown",
    }),
    options: config.servers.map((server) => ({
      label: server.name,
      value: server.base_url,
      hint: server.base_url,
    })),
  });
  if (!target_base_url || isCancel(target_base_url)) {
    return undefined;
  }

  const current = readServer(String(target_base_url));
  if (!current) {
    showError(t({
      zh: "所选 Downtown 已不存在。",
      en: "Selected Downtown no longer exists.",
    }));
    return undefined;
  }

  const field = await select({
    message: t({
      zh: `编辑 ${current.name}`,
      en: `Edit ${current.name}`,
    }),
    options: [
      {
        label: t({ zh: "名称", en: "Name" }),
        value: "name",
        hint: current.name,
      },
      {
        label: t({ zh: "Downtown URL", en: "Downtown URL" }),
        value: "base_url",
        hint: current.base_url,
      },
      {
        label: t({ zh: "取消", en: "Cancel" }),
        value: "cancel",
        hint: t({
          zh: "不做修改直接返回",
          en: "Return without changes",
        }),
      },
    ],
  });
  if (!field || isCancel(field) || field === "cancel") {
    return undefined;
  }

  const next = { ...current };

  if (field === "name") {
    const name = await text({
      message: t({
        zh: "显示名称",
        en: "Display name",
      }),
      initialValue: current.name,
    });
    if (!name || isCancel(name)) return undefined;
    next.name = String(name).trim() || current.name;
  } else if (field === "base_url") {
    const next_base_url = await text({
      message: t({
        zh: "Downtown URL",
        en: "Downtown URL",
      }),
      initialValue: current.base_url,
    });
    if (!next_base_url || isCancel(next_base_url)) return undefined;
    next.base_url = String(next_base_url).trim() || current.base_url;
  }

  const updated = updateServer(current.base_url, next);
  const verified = await verify_downtown_public_access(updated);
  if (verified) {
    showSuccess(t({
      zh: `Downtown 已更新：${updated.name}`,
      en: `Downtown updated: ${updated.name}`,
    }));
  } else {
    showError(t({
      zh: `Downtown 已保存，但公共可达性检查失败：${updated.name}`,
      en: `Downtown saved, but the public reachability check failed: ${updated.name}`,
    }));
  }
  return updated;
}

/**
 * 为指定 Downtown 配置 admin 访问凭证。
 */
export async function prompt_configure_downtown_admin_access(
  base_url: string,
): Promise<ServerProfile | undefined> {
  const current = readServer(base_url);
  if (!current) {
    showError(t({
      zh: "所选 Downtown 已不存在。",
      en: "Selected Downtown no longer exists.",
    }));
    return undefined;
  }

  const admin_id = await text({
    message: t({
      zh: "管理员 ID",
      en: "Administrator ID",
    }),
    initialValue: current.admin_id,
  });
  if (!admin_id || isCancel(admin_id) || !String(admin_id).trim()) return undefined;
  const admin_password = await password({
    message: t({ zh: "管理员密码", en: "Administrator password" }),
  });
  if (!admin_password || isCancel(admin_password) || !String(admin_password)) {
    return undefined;
  }
  let session;
  try {
    session = await login_downtown_admin({
      base_url: current.base_url,
      admin_id: String(admin_id),
      password: String(admin_password),
    });
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    return undefined;
  }
  const updated = updateServer(current.base_url, {
    ...current,
    admin_id: session.admin_id,
    admin_session_token: session.session_token,
    admin_session_expires_at: session.expires_at,
  });
  showSuccess(t({
    zh: `管理员已登录：${updated.name}`,
    en: `Administrator signed in: ${updated.name}`,
  }));

  return updated;
}

/**
 * 移除已保存的 Downtown 连接。
 */
export async function prompt_remove_downtown_server(base_url?: string): Promise<boolean> {
  const config = readConfig();
  if (config.servers.length === 0) {
    showError(t({
      zh: "当前没有已配置的 Downtown。",
      en: "No Downtowns configured.",
    }));
    return false;
  }

  const selected = base_url ?? await select({
    message: t({
      zh: "移除 Downtown",
      en: "Remove Downtown",
    }),
    options: [
      ...config.servers.map((server) => ({
        label: server.name,
        value: server.base_url,
        hint: server.base_url,
      })),
      {
        label: t({ zh: "取消", en: "Cancel" }),
        value: "cancel",
        hint: t({
          zh: "不做修改直接返回",
          en: "Return without changes",
        }),
      },
    ],
  });
  if (!selected || isCancel(selected) || selected === "cancel") {
    return false;
  }

  removeServer(String(selected));
  showSuccess(t({
    zh: "Downtown 连接记录已移除。",
    en: "Downtown connection removed.",
  }));
  return true;
}

async function verify_downtown_public_access(server: ServerProfile): Promise<boolean> {
  try {
    const response = await fetch(`${server.base_url.replace(/\/+$/u, "")}/v1/services`);
    return response.ok;
  } catch {
    return false;
  }
}

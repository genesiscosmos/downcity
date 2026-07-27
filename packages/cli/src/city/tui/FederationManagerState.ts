/**
 * Federation 管理器状态构建与动作处理。
 *
 * 关键点（中文）
 * - 负责读取当前 Federation 成员资格、构建菜单项、处理用户动作。
 * - 与 TUI 渲染解耦，便于单独测试和后续扩展。
 */

import {
  DEFAULT_CITY_ID,
  list_federations,
  read_current_city_session,
  readPersistedCityCliLocale,
  readCityState,
  resolve_selected_federation_url,
  upsert_federation_profile,
  writeCityState,
} from "@/city/shared/CityStateStore.js";
import { performCityUserLogin } from "@/city/shared/CityUserLogin.js";
import { CityUserManager } from "@/city/shared/CityUserManager.js";
import {
  readCurrentCityBalance,
  rechargeCurrentCityUser,
} from "@/city/shared/CityBalance.js";
import { promptAndPersistCityCliLocale } from "@/city/shared/InteractiveLocale.js";
import { getCliLocale, t } from "@/shared/CliLocale.js";
import {
  prompt_city_url,
  prompt_federation,
  prompt_recharge_input,
} from "@/city/tui/FederationManagerPrompts.js";
import {
  format_membership_detail,
  format_federation_list_detail,
  format_login_detail,
  format_balance_detail,
  format_current_user_detail,
  format_session_detail,
  format_recharge_result,
  format_error_detail,
  loading_text,
  format_locale_description,
  build_city_subtitle,
} from "@/city/tui/FederationManagerFormat.js";
import type { FederationMembershipState, FederationProfile } from "@/city/types/FederationMembership.js";
import type { CityBalanceAccount } from "@/city/types/CityBalance.js";
import type { CityUserSession } from "@/city/types/CitySession.js";
import type { tui_list_item } from "@/city/types/Tui.js";

/** Federation 管理器可选动作。 */
export type city_manager_action =
  | "status"
  | "use"
  | "connect"
  | "list"
  | "login"
  | "whoami"
  | "recharge"
  | "logout"
  | "language"
  | "exit";

/** Federation 管理器状态快照。 */
export interface city_manager_state {
  /** 左侧菜单项。 */
  items: tui_list_item[];

  /** 顶部副标题。 */
  subtitle: string;

  /** 当前 Federation 状态。 */
  membership: FederationMembershipState;

  /** 当前余额摘要。 */
  balance?: CityBalanceAccount | null;

  /** 余额读取错误。 */
  balance_error?: string;

  /** 选中项底部提示覆盖内容。 */
  detail_override?: string;

  /** 最近一次动作结果。 */
  last_message?: string;

  /** 初始聚焦动作。 */
  initial_action?: city_manager_action;
}

const cityUserManager = new CityUserManager();

export function read_federation_membership_state(): FederationMembershipState {
  const state = readCityState();
  const federation_url = resolve_selected_federation_url(state);
  const session = state.sessions?.[federation_url] ?? null;
  if (session?.user_token) {
    return {
      federation_url,
      city_id: session.city_id || DEFAULT_CITY_ID,
      has_user_token: true,
      source: "city-session",
      user_id: session.user_id,
      user_label: session.user_label,
    };
  }

  const server = list_federations().find((item) => item.federation_url === federation_url);
  return {
    federation_url,
    city_id: DEFAULT_CITY_ID,
    has_user_token: false,
    source: server?.source === "city-admin"
      ? "city-admin"
      : server?.source === "city"
        ? "city-base"
        : "default",
  };
}

export function save_city_user_session(session: CityUserSession): void {
  const state = upsert_federation_profile(readCityState(), {
    federation_url: session.federation_url,
  });
  const sessions = {
    ...(state.sessions ?? {}),
    [session.federation_url]: session,
  };
  writeCityState({
    ...state,
    selected_federation_url: session.federation_url,
    sessions,
  });
}

/**
 * 构建 Federation 管理器状态。
 */
export async function build_city_manager_state(params?: {
  initial_action?: city_manager_action;
  detail_override?: string;
  last_message?: string;
}): Promise<city_manager_state> {
  const membership = read_federation_membership_state();
  const balance_result = membership.has_user_token
    ? await read_balance_summary()
    : { account: null, error: undefined };
  const items = build_city_items({
    membership,
    balance: balance_result.account,
    balance_error: balance_result.error,
  });

  return {
    items,
    membership,
    balance: balance_result.account,
    balance_error: balance_result.error,
    detail_override: params?.detail_override,
    last_message: params?.last_message,
    initial_action: params?.initial_action,
    subtitle: build_city_subtitle(membership, balance_result.account),
  };
}

async function read_balance_summary(): Promise<{
  account: CityBalanceAccount | null;
  error?: string;
}> {
  try {
    return {
      account: await readCurrentCityBalance(),
    };
  } catch (error) {
    return {
      account: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function build_city_items(params: {
  membership: FederationMembershipState;
  balance: CityBalanceAccount | null;
  balance_error?: string;
}): tui_list_item[] {
  const items: tui_list_item[] = [
    section_item("status", t({ zh: "状态", en: "Status" })),
    {
      id: "status",
      title: t({ zh: "查看成员资格状态", en: "View membership status" }),
      subtitle: params.membership.federation_url,
      detail: format_membership_detail(params.membership),
    },
    section_item("city", "City"),
    {
      id: "use",
      title: t({ zh: "选择 Federation", en: "Select Federation" }),
      subtitle: t({
        zh: "从 City 本地 / downfed admin 已保存项中选择",
        en: "Choose from City-local or downfed-admin saved Federations",
      }),
      detail: format_federation_list_detail(list_federations()),
    },
    {
      id: "connect",
      title: t({ zh: "加入 Federation", en: "Join Federation" }),
      subtitle: t({
        zh: "手动写入一个 City 可用的 City",
        en: "Manually join a Federation",
      }),
      detail: t({
        zh: "输入 City URL 后会保存到 City 本地，并设为当前 City。",
        en: "Enter a Federation URL to save it locally and make it the current Federation.",
      }),
    },
    {
      id: "list",
      title: t({ zh: "查看可用 Federation", en: "List Federations" }),
      subtitle: t({
        zh: `${list_federations().length} 个可用 Federation`,
        en: `${list_federations().length} available Federations`,
      }),
      detail: format_federation_list_detail(list_federations()),
    },
    section_item("account", t({ zh: "账号", en: "Account" })),
  ];

  if (!params.membership.has_user_token) {
    items.push({
      id: "login",
      title: t({ zh: "登录", en: "Sign in" }),
      subtitle: t({
        zh: "登录当前 Federation",
        en: "Sign in to the current Federation",
      }),
      detail: format_login_detail(params.membership),
    });
  } else {
    items.push(
      {
        id: "whoami",
        title: t({ zh: "当前账号", en: "Current account" }),
        subtitle: params.membership.user_label || params.membership.user_id || params.membership.city_id,
        detail: format_membership_detail(params.membership),
      },
      {
        id: "credits",
        title: params.balance
          ? t({
            zh: `Credits：${params.balance.display || params.balance.credits}`,
            en: `Credits: ${params.balance.display || params.balance.credits}`,
          })
          : t({ zh: "Credits：暂不可用", en: "Credits: unavailable" }),
        subtitle: params.balance
          ? t({
            zh: `更新：${params.balance.updated_at}`,
            en: `Updated: ${params.balance.updated_at}`,
          })
          : params.balance_error ?? "",
        detail: params.balance
          ? format_balance_detail(params.balance)
          : format_error_detail(t({ zh: "Credits 暂不可用", en: "Credits unavailable" }), params.balance_error),
        disabled: true,
      },
      {
        id: "recharge",
        title: t({ zh: "充值", en: "Recharge" }),
        subtitle: t({
          zh: "给当前账号发起 checkout 充值",
          en: "Start a checkout recharge for the current account",
        }),
        detail: t({
          zh: "输入金额和说明后，City 会创建充值单和 checkout 页面。",
          en: "Enter a credits amount and note; City will create a topup and checkout page.",
        }),
      },
      {
        id: "logout",
        title: t({ zh: "登出", en: "Sign out" }),
        subtitle: t({
          zh: "清除当前 City 的 Federation 登录态",
          en: "Clear the City session for the current City",
        }),
        detail: t({
          zh: "只清除 City 本地保存的当前 Federation 登录态，不删除 City 账号。",
          en: "Only clears City's local session for the current City; it does not delete the City account.",
        }),
      },
    );
  }

  items.push(
    section_item("settings", t({ zh: "设置", en: "Settings" })),
    {
      id: "language",
      title: t({ zh: "切换语言", en: "Language" }),
      subtitle: format_locale_description(readPersistedCityCliLocale() ?? getCliLocale()),
      detail: t({
        zh: "切换 City CLI 的默认语言，并保存到本地。",
        en: "Switch the default City CLI language and persist it locally.",
      }),
    },
    section_item("navigation", t({ zh: "导航", en: "Navigation" })),
    {
      id: "exit",
      title: t({ zh: "退出", en: "Exit" }),
      subtitle: t({ zh: "关闭 City 连接管理", en: "Close City membership management" }),
      detail: t({
        zh: "退出当前 Federation管理 TUI。",
        en: "Exit the current City membership TUI.",
      }),
    },
  );

  return items;
}

export async function handle_city_action(params: {
  action: city_manager_action;
  set_detail: (content: string) => void;
  refresh_state: (state?: {
    keep_action?: city_manager_action;
    detail_override?: string;
    last_message?: string;
  }) => Promise<void>;
}): Promise<void> {
  if (params.action === "status") {
    const state = read_federation_membership_state();
    await params.refresh_state({
      keep_action: "status",
      detail_override: format_membership_detail(state),
    });
    return;
  }

  if (params.action === "list") {
    await params.refresh_state({
      keep_action: "list",
      detail_override: format_federation_list_detail(list_federations()),
    });
    return;
  }

  if (params.action === "whoami") {
    params.set_detail(loading_text(t({ zh: "正在读取当前账号", en: "Reading current account" })));
    try {
      const user = await cityUserManager.resolveCurrentUser();
      await params.refresh_state({
        keep_action: "whoami",
        detail_override: format_current_user_detail(user),
      });
    } catch (error) {
      await params.refresh_state({
        keep_action: "whoami",
        detail_override: format_error_detail(
          t({ zh: "当前账号不可用", en: "Current account unavailable" }),
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
    return;
  }

  if (params.action === "logout") {
    const federation_url = resolve_selected_federation_url(readCityState());
    const state = readCityState();
    const sessions = { ...(state.sessions ?? {}) };
    delete sessions[federation_url];
    writeCityState({ ...state, sessions });
    await params.refresh_state({
      keep_action: "login",
      detail_override: t({
        zh: `已登出当前 City：${federation_url}`,
        en: `Signed out from current City: ${federation_url}`,
      }),
    });
    return;
  }
}

export async function handle_city_prompt_action(
  action: city_manager_action,
): Promise<{
  initial_action?: city_manager_action;
  detail_override?: string;
  last_message?: string;
}> {
  if (action === "connect") {
    const federation_url = await prompt_city_url();
    if (!federation_url) {
      return {
        initial_action: "connect",
        detail_override: t({ zh: "已取消添加 City。", en: "Join Federation cancelled." }),
      };
    }
    writeCityState(upsert_federation_profile(readCityState(), { federation_url }));
    return {
      initial_action: "status",
      detail_override: t({
        zh: `已添加并选择 City：${federation_url}`,
        en: `Added and selected City: ${federation_url}`,
      }),
    };
  }

  if (action === "use") {
    const server = await prompt_federation();
    if (!server) {
      return {
        initial_action: "use",
        detail_override: t({ zh: "已取消选择 City。", en: "Select Federation cancelled." }),
      };
    }
    select_federation(server);
    return {
      initial_action: "status",
      detail_override: t({
        zh: `已选择 Federation：${server.federation_url}`,
        en: `Selected Federation: ${server.federation_url}`,
      }),
    };
  }

  if (action === "login") {
    const membership = read_federation_membership_state();
    const session = await performCityUserLogin({
      federation_url: membership.federation_url,
      city_id: read_current_city_session()?.city_id || DEFAULT_CITY_ID,
    });
    if (!session) {
      return {
        initial_action: "login",
        detail_override: t({ zh: "登录已取消。", en: "Sign-in cancelled." }),
      };
    }
    save_city_user_session(session);
    return {
      initial_action: "whoami",
      detail_override: format_session_detail(session),
    };
  }

  if (action === "recharge") {
    const input = await prompt_recharge_input();
    if (!input) {
      return {
        initial_action: "recharge",
        detail_override: t({ zh: "充值已取消。", en: "Recharge cancelled." }),
      };
    }
    try {
      const result = await rechargeCurrentCityUser(input);
      return {
        initial_action: "recharge",
        detail_override: format_recharge_result(result),
      };
    } catch (error) {
      return {
        initial_action: "recharge",
        detail_override: format_error_detail(
          t({ zh: "充值失败", en: "Recharge failed" }),
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  }

  if (action === "language") {
    const locale = await promptAndPersistCityCliLocale({ silent: true });
    return {
      initial_action: "language",
      detail_override: locale
        ? t({
          zh: locale === "zh" ? "当前默认语言已保存为中文。" : "当前默认语言已保存为英文。",
          en: locale === "zh"
            ? "Chinese has been saved as the default language."
            : "English has been saved as the default language.",
        })
        : t({ zh: "语言切换已取消。", en: "Language switch cancelled." }),
    };
  }

  return {
    initial_action: "status",
  };
}

export function is_prompt_action(action: city_manager_action): boolean {
  return action === "connect" ||
    action === "use" ||
    action === "login" ||
    action === "recharge" ||
    action === "language";
}
export function select_federation(server: FederationProfile): void {
  writeCityState(upsert_federation_profile(readCityState(), {
    federation_url: server.federation_url,
    name: server.name,
  }));
}
export function section_item(id: string, title: string): tui_list_item {
  return {
    id: `section:${id}`,
    title,
    subtitle: "",
    detail: "",
    disabled: true,
  };
}

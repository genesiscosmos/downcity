/**
 * Federation 本地数据分析与管理 UI。
 *
 * 浏览器只访问同源 BFF；图表使用内联 SVG，避免本地控制面引入运行时依赖。
 */

const pages = [
  ["overview", "▦", "数据概览", "活跃、调用、Token 与 Credits 全局趋势", "分析"],
  ["activity", "⌁", "用户活跃", "DAU、WAU、MAU 与活跃时间分布", "分析"],
  ["consumption", "◫", "Usage 消耗", "调用、Token、Credits、模型与 Action", "分析"],
  ["retention", "◌", "用户留存", "注册 Cohort 的 D1 / D3 / D7 / D14 / D30 留存", "分析"],
  ["quality", "◇", "调用质量", "成功率、计量可靠性与执行耗时", "分析"],
  ["usage", "◎", "用户明细", "各用户调用、Token、Credits 与耗时", "分析"],
  ["users", "♙", "用户", "Federation 用户记录", "管理"],
  ["sessions", "◍", "Sessions", "登录会话状态", "管理"],
  ["bureaus", "⬡", "产品 / Bureau", "产品身份与授权域", "管理"],
  ["models", "◈", "模型", "模型目录与就绪状态", "资源"],
  ["env", "⌘", "环境变量", "运行环境配置", "资源"],
  ["services", "▣", "Services", "服务目录", "资源"],
  ["credits_users", "◉", "Credits", "用户余额与交易", "交易"],
  ["payments", "▤", "支付", "支付与 Webhook", "交易"],
  ["debugger", "⌗", "Service 调试", "受限 GET / POST 调试器", "工具"],
];

const analysis_pages = new Set(["overview", "activity", "consumption", "retention", "quality", "usage"]);
const state = { page: "overview", context: null, usage_users: [], usage_page: 1 };
const content = document.querySelector("#content");
const title = document.querySelector("#page-title");
const description = document.querySelector("#page-description");
const range = document.querySelector("#range");
const refresh = document.querySelector("#refresh");

function build_navigation() {
  let group = "";
  document.querySelector("#navigation").innerHTML = pages.map(([id, icon, label, , next_group]) => {
    const heading = next_group !== group ? `<div class="nav-label">${next_group}</div>` : "";
    group = next_group;
    return `${heading}<button class="nav-item" data-page="${id}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`;
  }).join("");
  document.querySelectorAll("[data-page]").forEach((node) => node.addEventListener("click", () => navigate(node.dataset.page)));
}

async function api(path, options) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

async function navigate(page) {
  state.page = page;
  document.querySelectorAll("[data-page]").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
  const current = pages.find((item) => item[0] === page);
  title.textContent = current?.[2] ?? page;
  description.textContent = current?.[3] ?? "";
  range.hidden = !analysis_pages.has(page);
  content.innerHTML = `<div class="loading">正在读取 Federation 数据…</div>`;
  try {
    if (page === "overview") await render_overview();
    else if (page === "activity") await render_activity();
    else if (page === "consumption") await render_consumption();
    else if (page === "retention") await render_retention();
    else if (page === "quality") await render_quality();
    else if (page === "usage") await render_usage_users();
    else if (page === "debugger") render_debugger();
    else await render_resource(page);
  } catch (error) {
    content.innerHTML = `<div class="error-box">${escape_html(error.message)}</div>`;
  }
}

function analytics_url(kind) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return `/api/usage/${kind}?range=${range.value}&timezone=${encodeURIComponent(timezone)}`;
}

async function load_overview() {
  return await api(analytics_url("overview"));
}

function metric_cards(items) {
  return `<div class="metric-grid">${items.map(([label, value, hint, tone = ""]) => `<article class="metric ${tone}"><div class="metric-label">${escape_html(label)}</div><strong>${escape_html(value)}</strong><p>${escape_html(hint)}</p></article>`).join("")}</div>`;
}

function panel(title_text, body, meta = "", class_name = "") {
  return `<section class="panel ${class_name}"><div class="panel-title"><div><h2>${escape_html(title_text)}</h2></div><span>${escape_html(meta)}</span></div>${body}</section>`;
}

async function render_overview() {
  const usage = await load_overview();
  const summary = usage.summary;
  const metrics = [
    ["注册用户", number(usage.total_registered_users), `范围新增 ${number(usage.new_registered_users)}`],
    ["DAU", number(usage.activity.daily_active_users), `粘性 ${percent(usage.activity.daily_monthly_stickiness)}`, "accent"],
    ["WAU", number(usage.activity.weekly_active_users), "滚动 7 天去重"],
    ["MAU", number(usage.activity.monthly_active_users), "滚动 30 天去重"],
    ["AI 调用", number(summary.execution_count), `成功率 ${percent(summary.success_rate)}`],
    ["Total Tokens", compact_number(summary.total_tokens), `Input ${compact_number(summary.input_tokens)} · Output ${compact_number(summary.output_tokens)}`],
    ["Credits", compact_number(summary.credits_used), `${number(summary.charge_count)} 笔 Charge`],
    ["P95 耗时", duration(usage.performance.p95_duration_ms), `${number(usage.performance.sample_count)} 个样本`],
  ];
  const activity_chart = line_chart(usage.days, [
    ["DAU", "active_user_count", "#2563eb"],
    ["WAU", "weekly_active_user_count", "#7c3aed"],
    ["MAU", "monthly_active_user_count", "#0f766e"],
  ]);
  const calls_chart = mixed_daily_chart(usage.days);
  const top_users = await api(analytics_url("users"));
  const ranking = sort_usage_users(top_users.items, "total_tokens").slice(0, 6).map((item, index) => `<div class="ranking-row"><span class="rank">${index + 1}</span><div class="ranking-user"><strong>${escape_html(item.email || item.user_id)}</strong><small>${escape_html(item.top_model_id || "暂无模型")}</small></div><div class="ranking-value"><strong>${compact_number(item.total_tokens)}</strong><small>${number(item.execution_count)} calls</small></div></div>`).join("") || `<div class="empty compact-empty">暂无活跃用户</div>`;
  content.innerHTML = `${metric_cards(metrics)}<div class="analytics-grid wide-left">${panel("活跃用户趋势", activity_chart, usage.timezone)}${panel("Token 消耗排行", ranking, "TOTAL TOKENS · TOP 6")}</div><div class="analytics-grid">${panel("调用与成功率", calls_chart, range.options[range.selectedIndex].text)}${panel("Token 构成", stacked_chart(usage.days, [["未缓存输入", "uncached_input_tokens", "#2563eb"], ["缓存输入", "cached_input_tokens", "#60a5fa"], ["输出", "output_tokens", "#8b5cf6"], ["推理", "reasoning_tokens", "#c4b5fd"]]), "STACKED")}</div>`;
}

async function render_activity() {
  const usage = await load_overview();
  content.innerHTML = `${metric_cards([
    ["范围活跃", number(usage.activity.range_active_users), range.options[range.selectedIndex].text],
    ["DAU", number(usage.activity.daily_active_users), "当天去重用户", "accent"],
    ["WAU", number(usage.activity.weekly_active_users), "滚动 7 天去重"],
    ["MAU", number(usage.activity.monthly_active_users), "滚动 30 天去重"],
  ])}<div class="analytics-grid wide-left">${panel("DAU / WAU / MAU", line_chart(usage.days, [["DAU", "active_user_count", "#2563eb"], ["WAU", "weekly_active_user_count", "#8b5cf6"], ["MAU", "monthly_active_user_count", "#0d9488"]]), "真实去重口径")}${panel("24 小时活跃分布", bar_chart(usage.hours, "execution_count", "hour", "#2563eb", (value) => `${String(value).padStart(2, "0")}:00`), "LOCAL TIME")}</div>${panel("用户粘性 DAU / MAU", line_chart(usage.days, [["粘性", "daily_monthly_stickiness", "#ea580c"]], { percent: true }), "DAU ÷ MAU")}`;
}

async function render_consumption() {
  const usage = await load_overview();
  const summary = usage.summary;
  content.innerHTML = `${metric_cards([
    ["AI 调用", number(summary.execution_count), `${number(summary.metered_request_count)} 上游请求`, "accent"],
    ["Input Token", compact_number(summary.input_tokens), `Cached ${compact_number(summary.cached_input_tokens)}`],
    ["Output Token", compact_number(summary.output_tokens), `Reasoning ${compact_number(summary.reasoning_tokens)}`],
    ["Credits 消耗", compact_number(summary.credits_used), `${number(summary.charge_count)} 笔 Charge`],
  ])}<div class="analytics-grid">${panel("每日调用量", bar_chart(usage.days, "execution_count", "date", "#2563eb"), range.options[range.selectedIndex].text)}${panel("每日 Credits", bar_chart(usage.days, "credits_used", "date", "#7c3aed"), "APPLIED CHARGES")}</div>${panel("Token 每日构成", stacked_chart(usage.days, [["未缓存输入", "uncached_input_tokens", "#2563eb"], ["缓存输入", "cached_input_tokens", "#60a5fa"], ["输出", "output_tokens", "#8b5cf6"], ["推理", "reasoning_tokens", "#c4b5fd"]]), "STACKED")}
  <div class="analytics-grid">${panel("模型调用分布", horizontal_bars(usage.models.slice(0, 10), "execution_count", "key", "#2563eb"), "TOP 10")}${panel("Action 分布", horizontal_bars(usage.actions.slice(0, 10), "execution_count", "key", "#0d9488"), "TOP 10")}</div>`;
}

async function render_retention() {
  const data = await api(analytics_url("retention"));
  const rates = data.average_rates;
  const rate_items = [["D1", rates.day_1], ["D3", rates.day_3], ["D7", rates.day_7], ["D14", rates.day_14], ["D30", rates.day_30]];
  const retention_series = [
    ["D1", "day_1", "#2563eb"], ["D3", "day_3", "#0d9488"], ["D7", "day_7", "#7c3aed"], ["D14", "day_14", "#ea580c"], ["D30", "day_30", "#dc2626"],
  ];
  const chart_data = data.cohorts.map((cohort) => ({ date: cohort.date, ...cohort.rates }));
  const rows = data.cohorts.map((cohort) => `<tr><td>${escape_html(cohort.date)}</td><td>${number(cohort.new_user_count)}</td>${[1, 3, 7, 14, 30].map((day) => `<td>${heat_cell(cohort.rates[`day_${day}`])}</td>`).join("")}</tr>`).join("");
  content.innerHTML = `${metric_cards([["注册用户", number(data.total_registered_users), "全部注册用户"], ...rate_items.map(([label, value], index) => [`${label} 留存`, percent(value), "按注册 Cohort 加权", index === 0 ? "accent" : ""])])}<div class="analytics-grid wide-left">${panel("留存率趋势", line_chart(chart_data, retention_series, { percent: true }), "REGISTRATION COHORT")}${panel("平均留存漏斗", funnel_chart(rate_items), "WEIGHTED")}</div>${panel("每日新增用户", bar_chart(data.registration_days, "new_user_count", "date", "#2563eb"), range.options[range.selectedIndex].text)}${panel("Cohort 留存表", `<div class="table-wrap cohort-table"><table><thead><tr><th>注册日期</th><th>新增</th><th>D1</th><th>D3</th><th>D7</th><th>D14</th><th>D30</th></tr></thead><tbody>${rows}</tbody></table></div>`, "精确日留存")}`;
}

async function render_quality() {
  const usage = await load_overview();
  const performance = usage.performance;
  const summary = usage.summary;
  const model_rows = usage.models.map((item) => `<tr><td><strong>${escape_html(item.key)}</strong></td><td>${number(item.execution_count)}</td><td>${percent(item.execution_count ? item.succeeded_count / item.execution_count : null)}</td><td>${compact_number(item.total_tokens)}</td><td>${duration(item.average_duration_ms)}</td></tr>`).join("");
  content.innerHTML = `${metric_cards([
    ["成功率", percent(summary.success_rate), `${number(summary.succeeded_count)} 次成功`, "accent"],
    ["平均耗时", duration(performance.average_duration_ms), `${number(performance.sample_count)} 个样本`],
    ["P50 / P95", `${duration(performance.p50_duration_ms)} / ${duration(performance.p95_duration_ms)}`, `最大 ${duration(performance.max_duration_ms)}`],
    ["计量不可用", number(performance.metering_unavailable_count), `${percent(summary.execution_count ? performance.metering_unavailable_count / summary.execution_count : null)} of calls`],
  ])}<div class="analytics-grid">${panel("执行结果趋势", stacked_chart(usage.days, [["成功", "succeeded_count", "#16a34a"], ["失败", "failed_count", "#dc2626"], ["取消", "cancelled_count", "#f59e0b"]]), "OUTCOME")}${panel("执行耗时趋势", line_chart(usage.days, [["平均", "average_duration_ms", "#2563eb"], ["P95", "p95_duration_ms", "#7c3aed"]]), "MILLISECONDS")}</div>${panel("模型质量", `<div class="table-wrap"><table><thead><tr><th>模型</th><th>调用</th><th>成功率</th><th>Tokens</th><th>平均耗时</th></tr></thead><tbody>${model_rows}</tbody></table></div>`, `${usage.models.length} MODELS`)}`;
}

function line_chart(data, series, options = {}) {
  if (!data.length) return `<div class="empty compact-empty">暂无趋势数据</div>`;
  const width = 760, height = 280, left = 46, right = 16, top = 20, bottom = 34;
  const values = data.flatMap((item) => series.map(([, key]) => Number(item[key])).filter(Number.isFinite));
  const max_value = Math.max(1, ...values);
  const x = (index) => left + index * (width - left - right) / Math.max(1, data.length - 1);
  const y = (value) => top + (height - top - bottom) * (1 - Math.max(0, Number(value) || 0) / max_value);
  const grid = Array.from({ length: 5 }, (_, index) => { const ratio = index / 4; const grid_y = top + ratio * (height - top - bottom); const value = max_value * (1 - ratio); return `<line x1="${left}" x2="${width - right}" y1="${grid_y}" y2="${grid_y}"/><text x="${left - 8}" y="${grid_y + 4}">${options.percent ? `${Math.round(value * 100)}%` : compact_number(value)}</text>`; }).join("");
  const paths = series.map(([, key, color]) => { const points = data.map((item, index) => Number.isFinite(Number(item[key])) ? `${x(index)},${y(item[key])}` : null).filter(Boolean).join(" "); return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; }).join("");
  const labels = data.map((item, index) => index % Math.max(1, Math.ceil(data.length / 6)) === 0 || index === data.length - 1 ? `<text x="${x(index)}" y="${height - 8}" text-anchor="middle">${escape_html(String(item.date ?? item.label ?? "").slice(5))}</text>` : "").join("");
  const legend = `<div class="chart-legend">${series.map(([label, , color]) => `<span><i style="background:${color}"></i>${escape_html(label)}</span>`).join("")}</div>`;
  return `${legend}<svg class="chart" viewBox="0 0 ${width} ${height}" role="img"><g class="chart-grid">${grid}${labels}</g>${paths}</svg>`;
}

function bar_chart(data, value_key, label_key, color, label_format = (value) => String(value).slice(5)) {
  if (!data.length) return `<div class="empty compact-empty">暂无分布数据</div>`;
  const width = 760, height = 260, left = 42, right = 12, top = 16, bottom = 34;
  const max_value = Math.max(1, ...data.map((item) => Number(item[value_key]) || 0));
  const slot = (width - left - right) / data.length;
  const bar_width = Math.max(2, slot * 0.62);
  const bars = data.map((item, index) => { const value = Number(item[value_key]) || 0; const bar_height = (height - top - bottom) * value / max_value; const bar_x = left + index * slot + (slot - bar_width) / 2; return `<rect x="${bar_x}" y="${height - bottom - bar_height}" width="${bar_width}" height="${bar_height}" rx="3" fill="${color}"><title>${escape_html(label_format(item[label_key]))}: ${number(value)}</title></rect>${index % Math.max(1, Math.ceil(data.length / 7)) === 0 ? `<text x="${bar_x + bar_width / 2}" y="${height - 10}" text-anchor="middle">${escape_html(label_format(item[label_key]))}</text>` : ""}`; }).join("");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${bars}</svg>`;
}

function stacked_chart(data, series) {
  if (!data.length) return `<div class="empty compact-empty">暂无趋势数据</div>`;
  const width = 760, height = 270, left = 42, right = 12, top = 16, bottom = 34;
  const totals = data.map((item) => series.reduce((sum, [, key]) => sum + (Number(item[key]) || 0), 0));
  const max_value = Math.max(1, ...totals); const slot = (width - left - right) / data.length; const bar_width = Math.max(2, slot * 0.68);
  const bars = data.map((item, index) => { let cursor = height - bottom; return series.map(([label, key, color]) => { const value = Number(item[key]) || 0; const bar_height = (height - top - bottom) * value / max_value; cursor -= bar_height; return `<rect x="${left + index * slot + (slot - bar_width) / 2}" y="${cursor}" width="${bar_width}" height="${bar_height}" fill="${color}"><title>${escape_html(item.date)} · ${escape_html(label)}: ${number(value)}</title></rect>`; }).join(""); }).join("");
  return `<div class="chart-legend">${series.map(([label, , color]) => `<span><i style="background:${color}"></i>${escape_html(label)}</span>`).join("")}</div><svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${bars}</svg>`;
}

function mixed_daily_chart(days) {
  return line_chart(days, [["调用量", "execution_count", "#2563eb"], ["成功", "succeeded_count", "#16a34a"], ["失败", "failed_count", "#dc2626"]]);
}

function horizontal_bars(data, value_key, label_key, color) {
  if (!data.length) return `<div class="empty compact-empty">暂无分布数据</div>`;
  const max_value = Math.max(1, ...data.map((item) => Number(item[value_key]) || 0));
  return `<div class="horizontal-bars">${data.map((item) => `<div class="horizontal-row"><div><strong>${escape_html(item[label_key])}</strong><span>${number(item[value_key])}</span></div><div class="bar-track"><i style="width:${(Number(item[value_key]) || 0) / max_value * 100}%;background:${color}"></i></div></div>`).join("")}</div>`;
}

function funnel_chart(items) {
  const max_value = Math.max(0.01, ...items.map(([, value]) => Number(value) || 0));
  return `<div class="funnel">${items.map(([label, value], index) => `<div style="width:${Math.max(28, (Number(value) || 0) / max_value * 100)}%;opacity:${1 - index * 0.1}"><span>${label}</span><strong>${percent(value)}</strong></div>`).join("")}</div>`;
}

function heat_cell(value) {
  if (value === null || value === undefined) return `<span class="retention-cell pending">—</span>`;
  const alpha = 0.08 + Math.min(0.72, Number(value) * 0.72);
  return `<span class="retention-cell" style="background:rgba(37,99,235,${alpha})">${percent(value)}</span>`;
}

async function render_usage_users() {
  const data = await api(analytics_url("users"));
  state.usage_users = data.items;
  state.usage_page = 1;
  content.innerHTML = `<div class="toolbar"><div class="search-field"><span>⌕</span><input id="usage-search" placeholder="搜索邮箱或 user_id"></div><select id="usage-sort"><option value="total_tokens">按 Token 消耗</option><option value="credits_used">按 Credits 消耗</option><option value="execution_count">按调用量</option><option value="p95_duration_ms">按 P95 耗时</option><option value="last_active_at">按最后活跃</option></select><span class="badge">${data.items.length} USERS</span></div><div id="usage-table"></div><div id="usage-drawer"></div>`;
  document.querySelector("#usage-search").addEventListener("input", () => { state.usage_page = 1; render_usage_table(); });
  document.querySelector("#usage-sort").addEventListener("change", () => { state.usage_page = 1; render_usage_table(); });
  render_usage_table();
}

function render_usage_table() {
  const query = value("usage-search").toLowerCase();
  const sort_key = value("usage-sort") || "total_tokens";
  const items = sort_usage_users(
    state.usage_users.filter((item) => `${item.user_id} ${item.email}`.toLowerCase().includes(query)),
    sort_key,
  );
  const page_size = 25;
  const page_count = Math.max(1, Math.ceil(items.length / page_size));
  state.usage_page = Math.min(state.usage_page, page_count);
  const offset = (state.usage_page - 1) * page_size;
  document.querySelector("#usage-table").innerHTML = `${usage_table(items.slice(offset, offset + page_size))}<div class="pagination"><span>${number(items.length)} 位用户 · 第 ${state.usage_page} / ${page_count} 页</span><div><button id="usage-prev" ${state.usage_page <= 1 ? "disabled" : ""}>上一页</button><button id="usage-next" ${state.usage_page >= page_count ? "disabled" : ""}>下一页</button></div></div>`;
  document.querySelector("#usage-prev")?.addEventListener("click", () => { state.usage_page -= 1; render_usage_table(); });
  document.querySelector("#usage-next")?.addEventListener("click", () => { state.usage_page += 1; render_usage_table(); });
  document.querySelectorAll("[data-usage-user]").forEach((button) => button.addEventListener("click", () => show_usage_detail(decodeURIComponent(button.dataset.usageUser))));
}

function sort_usage_users(items, sort_key) {
  return [...items].sort((left, right) => {
    const difference = sort_key === "last_active_at"
      ? String(right.last_active_at || "").localeCompare(String(left.last_active_at || ""))
      : Number(right[sort_key] || 0) - Number(left[sort_key] || 0);
    return difference || String(left.user_id || "").localeCompare(String(right.user_id || ""));
  });
}

function usage_table(items) {
  if (!items.length) return `<div class="empty">没有匹配的用户</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>用户</th><th>最后活跃</th><th>调用</th><th>Total Tokens</th><th>Credits</th><th>成功率</th><th>平均 / P95</th><th>Top Model</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><div class="user-cell"><span class="avatar">${escape_html((item.email || item.user_id || "U").slice(0, 1).toUpperCase())}</span><div><strong>${escape_html(item.email || "—")}</strong><small>${escape_html(item.user_id)}</small></div></div></td><td>${item.last_active_at ? new Date(item.last_active_at).toLocaleString() : "从未活跃"}</td><td>${number(item.execution_count)}</td><td>${compact_number(item.total_tokens)}</td><td>${compact_number(item.credits_used)}</td><td>${percent(item.success_rate)}</td><td>${duration(item.average_duration_ms)} / ${duration(item.p95_duration_ms)}</td><td><span class="model-pill">${escape_html(item.top_model_id || "—")}</span></td><td><button class="quiet-button" data-usage-user="${encodeURIComponent(item.user_id)}">详情 →</button></td></tr>`).join("")}</tbody></table></div>`;
}

function show_usage_detail(user_id) {
  const item = state.usage_users.find((candidate) => candidate.user_id === user_id);
  if (!item) return;
  const drawer = document.querySelector("#usage-drawer");
  drawer.innerHTML = `<div class="drawer-backdrop" data-close-drawer></div><aside class="drawer"><div class="drawer-header"><div><span class="eyebrow">USER ANALYTICS</span><h2>${escape_html(item.email || item.user_id)}</h2><p>${escape_html(item.user_id)}</p></div><button class="icon-button" data-close-drawer>×</button></div>${metric_cards([["调用", number(item.execution_count), `${number(item.succeeded_count)} 成功`], ["Tokens", compact_number(item.total_tokens), `Cached ${compact_number(item.cached_input_tokens)}`], ["Credits", compact_number(item.credits_used), `${number(item.charge_count)} charges`], ["P95", duration(item.p95_duration_ms), `平均 ${duration(item.average_duration_ms)}`]])}<div class="detail-list"><div><span>执行结果</span><strong>${number(item.succeeded_count)} / ${number(item.failed_count)} / ${number(item.cancelled_count)}</strong></div><div><span>Input / Output</span><strong>${compact_number(item.input_tokens)} / ${compact_number(item.output_tokens)}</strong></div><div><span>Reasoning Tokens</span><strong>${compact_number(item.reasoning_tokens)}</strong></div><div><span>图片 / 视频 / 音频</span><strong>${number(item.image_count)} / ${number(item.video_seconds)}s / ${number(item.audio_seconds)}s</strong></div><div><span>计量不可用</span><strong>${number(item.metering_unavailable_count)}</strong></div></div></aside>`;
  drawer.querySelectorAll("[data-close-drawer]").forEach((node) => node.addEventListener("click", () => { drawer.innerHTML = ""; }));
}

async function render_resource(resource_id) {
  const { items } = await api(`/api/resources/${encodeURIComponent(resource_id)}`);
  const extra = resource_id === "env" ? env_toolbar() : resource_id === "bureaus" ? bureau_toolbar() : resource_id === "credits_users" ? `<button data-secondary="credits_transactions">查看 Transactions</button>` : resource_id === "payments" ? `<button data-secondary="payment_events">查看 Webhook Events</button>` : "";
  content.innerHTML = `<div class="toolbar"><span class="badge">${items.length} RECORDS</span>${extra}</div>${table(items)}`;
  bind_resource_actions(resource_id);
}

function table(items) {
  if (!items.length) return `<div class="empty">暂无数据</div>`;
  const keys = [...new Set(items.flatMap((item) => Object.keys(item ?? {})))].slice(0, 10);
  return `<div class="table-wrap"><table><thead><tr>${keys.map((key) => `<th>${escape_html(key)}</th>`).join("")}</tr></thead><tbody>${items.map((item) => `<tr>${keys.map((key) => `<td title="${escape_html(format(item[key]))}">${escape_html(format(item[key]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function env_toolbar() {
  return `<input id="env-key" placeholder="ENV_KEY"><input id="env-value" type="password" placeholder="value"><button class="primary" data-action="env_upsert">保存</button><button class="danger" data-action="env_remove">删除</button><button data-action="env_refresh">刷新 Runtime</button>`;
}

function bureau_toolbar() {
  return `<input id="bureau-id" placeholder="bureau_id"><input id="bureau-name" placeholder="name"><input id="bureau-url" placeholder="server_url"><button class="primary" data-action="bureau_create">创建</button><button data-action="bureau_activate">启用</button><button data-action="bureau_pause">暂停</button><button class="danger" data-action="bureau_archive">归档</button>`;
}

function bind_resource_actions(resource_id) {
  document.querySelectorAll("[data-secondary]").forEach((button) => button.addEventListener("click", async () => {
    content.innerHTML = `<div class="loading">正在读取…</div>`;
    try { const data = await api(`/api/resources/${button.dataset.secondary}`); content.innerHTML = `<div class="toolbar"><button id="back-resource">返回</button><span class="badge">${data.items.length} RECORDS</span></div>${table(data.items)}`; document.querySelector("#back-resource").onclick = () => navigate(resource_id); } catch (error) { show_toast(error.message, true); }
  }));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
    const action = button.dataset.action;
    const payload = action.startsWith("env_") ? { key: value("env-key"), value: value("env-value") } : { bureau_id: value("bureau-id"), name: value("bureau-name"), server_url: value("bureau-url") };
    if ((action === "bureau_archive" || action === "env_remove") && !confirm(`确认执行 ${action}？`)) return;
    try { await api("/api/actions", { method: "POST", body: JSON.stringify({ action, payload }) }); show_toast("操作成功"); await navigate(resource_id); } catch (error) { show_toast(error.message, true); }
  }));
}

function render_debugger() {
  content.innerHTML = `<section class="panel"><div class="form-grid"><div class="field"><label>Service ID</label><input id="service-id" placeholder="accounts"></div><div class="field"><label>Method</label><select id="method"><option>GET</option><option>POST</option></select></div><div class="field span-2"><label>Path</label><input id="service-path" placeholder="users"></div><div class="field span-2"><label>JSON Body</label><textarea id="service-body">{}</textarea></div><div><button class="primary" id="send-request">发送请求</button></div><div class="span-2"><pre class="result" id="debug-result">等待请求…</pre></div></div></section>`;
  document.querySelector("#send-request").addEventListener("click", async () => {
    const result = document.querySelector("#debug-result"); result.textContent = "请求中…";
    try { const body = JSON.parse(value("service-body") || "{}"); const data = await api("/api/actions", { method: "POST", body: JSON.stringify({ action: "service_request", payload: { service_id: value("service-id"), path: value("service-path"), method: value("method"), body } }) }); result.textContent = JSON.stringify(data.result, null, 2); } catch (error) { result.textContent = `Error: ${error.message}`; }
  });
}

function value(id) { return document.querySelector(`#${id}`)?.value?.trim() ?? ""; }
function format(input) { return input === null || input === undefined ? "" : typeof input === "object" ? JSON.stringify(input) : String(input); }
function number(input) { return Number(input || 0).toLocaleString(); }
function compact_number(input) { const value_number = Number(input || 0); return Math.abs(value_number) >= 1000 ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value_number) : number(value_number); }
function percent(input) { return input === null || input === undefined ? "—" : `${(Number(input) * 100).toFixed(1)}%`; }
function duration(input) { if (input === null || input === undefined) return "—"; const value_number = Number(input); return value_number >= 1000 ? `${(value_number / 1000).toFixed(2)}s` : `${Math.round(value_number)}ms`; }
function escape_html(input) { const node = document.createElement("span"); node.textContent = String(input); return node.innerHTML.replaceAll('"', "&quot;"); }
function show_toast(message, error = false) { const toast = document.querySelector("#toast"); toast.textContent = message; toast.className = error ? "show error" : "show"; setTimeout(() => { toast.className = ""; }, 2600); }

refresh.addEventListener("click", () => navigate(state.page));
range.addEventListener("change", () => navigate(state.page));
build_navigation();
api("/api/context").then((context) => { state.context = context; document.querySelector("#federation-name").textContent = context.federation_name; document.querySelector("#federation-url").textContent = context.federation_url; }).catch((error) => show_toast(error.message, true));
navigate("overview");

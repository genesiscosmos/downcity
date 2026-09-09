# Downcity Desktop 打包、R2 发布与 Homepage 下载设计

> 状态：待评审
>
> 日期：2026-09-09
>
> 首期范围：macOS Apple Silicon（arm64）
>
> 参考实现：`/Users/wangenius/Documents/github/duobox`

## 1. 结论

本需求可行，但不是补充一个 `electron-builder` 命令即可完成。Downcity 当前只能完成普通 Desktop 构建，尚未形成可发布的安装包事务。建议首期完整迁移 Duobox 已验证的 macOS 发布闭环，并按 Downcity 的命名、目录和工程规范收敛为以下流程：

```text
交互式发布确认
  -> 选择 Desktop 版本递增方式
  -> 构建并签名 arm64 .app
  -> Apple 公证并 staple
  -> 从已公证 .app 生成 DMG、ZIP、blockmap 和 latest-mac.yml
  -> 校验产物、签名、公证状态与 SHA-256
  -> 上传版本化不可变对象到 downcity R2
  -> 最后提交 macos-latest.json 指针
  -> downcity.ai/download/macos 提供稳定下载地址
```

首期不把 Desktop 自动更新 UI、下载统计、Windows/Linux 正式发布一起实现。发布时仍生成 ZIP、blockmap 与 `latest-mac.yml`，保持与 Electron updater 协议兼容，为后续自动更新复用同一份产物，避免重新设计存储协议。

## 2. 产品意图与边界

### 2.1 产品意图

该能力解决一个问题：维护者可以通过一次明确、可中断、可重试的发布操作，把经过签名与公证的 Downcity Desktop 安装包发布到 Downcity 自有 R2，并让用户始终通过官网稳定地址下载最新版本。

### 2.2 领域职责

| 领域 | 唯一职责 | 不负责 |
| --- | --- | --- |
| Desktop build | 生成可运行、已签名的 `.app` | 上传、latest 指针、Homepage 路由 |
| Apple notarization | 提交签名应用、公证、staple 并验证 | 重新构建应用 |
| Release packaging | 从已公证 `.app` 生成分发与 updater 产物 | 修改业务代码 |
| Release publisher | 校验并上传 R2 对象，最后提交 latest manifest | 构建或公证应用 |
| Homepage download gateway | 读取 latest manifest，校验路径并返回下载内容/跳转 | 决定版本、写入 R2 |
| Homepage UI | 向用户展示 Desktop 下载入口和平台要求 | 直接拼接具体版本文件名 |

### 2.3 所有权与单一事实源

- Desktop 发布版本的唯一事实源是 `app/desktop/package.json` 的 `version`。
- 某个版本的产物一旦写入 `releases/packages/macos/<version>/`，即视为不可变。
- 最新稳定版的唯一事实源是 R2 中的 `releases/manifests/macos-latest.json`。
- Homepage 不内置“最新版本号”，只通过 latest manifest 投影；manifest 不可用时隐藏动态版本信息，但下载入口仍返回明确错误，不静默指向旧文件。
- 根 `package.json` 版本和 npm packages 版本不随 Desktop 发布递增。Desktop 是 private app，不触发 SDK package patch bump。

## 3. 现状评估

### 3.1 Downcity 已具备的基础

- `app/desktop` 已使用 Electron 40、electron-vite 与 electron-builder。
- `app/desktop/electron-builder.yml` 已声明 macOS 的 DMG/ZIP target，以及 Windows NSIS、Linux AppImage target。
- Desktop 已有 macOS/Windows/Linux 图标资源。
- 根脚本已有 `build:desktop`，可先构建 City 与 Desktop。
- Homepage 已部署到 Cloudflare Pages，已有独立部署脚本。
- Homepage 的 `/start` 已具备平台选择交互，适合承载 CLI 与 Desktop 两种安装路径。

### 3.2 关键缺口

1. Desktop 没有 release 专用构建入口，开发构建与发布构建边界不清楚。
2. 没有 macOS Developer ID 凭据预检、签名结果验证、Apple 公证与 staple 流程。
3. 没有“从已公证 `.app` 封装 DMG/ZIP”的分阶段流程，失败后只能从头重来。
4. 没有稳定的 artifact 命名、SHA-256、文件大小和 latest manifest 协议。
5. 没有大文件分片上传、断点续传、重试、远端同内容跳过和上传状态清理。
6. 没有 R2 release bucket 的仓库级 binding 配置。当前 `homepage/wrangler.toml` 被 `.gitignore` 排除，不能作为团队可复现配置。
7. Homepage 没有 `/download/macos`、`/download/macos/latest.json` 与版本文件读取路由。
8. Homepage 没有 Desktop 下载 CTA；现有入口主要面向 npm CLI 与 SDK 文档。
9. Desktop 未配置 updater feed，也未依赖 `electron-updater`。这不阻塞下载安装，但当前不能承诺 App 内自动更新。

### 3.3 Duobox 可直接复用的设计

- `publish -> build -> notarize -> package -> upload` 的分阶段编排。
- 交互终端检查、发布摘要和最终确认。
- `patch/minor/major/none` 版本选择；非交互构建默认 `none`。
- R2 S3 API 上传器：小文件 PutObject，大文件 multipart，并发、指数退避和本地续传状态。
- 版本化对象先上传、latest manifest 最后上传的提交顺序。
- `/download/macos` 稳定地址和 `/download/macos/latest.json` 元数据地址。
- 版本文件路由白名单、GET/HEAD 支持、Content-Type、Content-Disposition、ETag 与不可变缓存。

### 3.4 不能原样复制的部分

- 产品名、bundle id、文件名、环境变量前缀、R2 bucket 与 URL 必须改为 Downcity。
- Downcity 自定义 manifest 字段必须使用 `snake_case`；`latest-mac.yml` 属于 electron-updater 第三方协议，保持其原始字段。
- Downcity Desktop 当前没有自动更新能力，因此首期只发布 updater-compatible 资产，不增加应用内 updater 状态机和设置 UI。
- Duobox 的下载计数依赖 D1；本需求只要求下载入口，首期不引入统计事实源与隐私口径。
- Downcity Homepage 当前使用静态预渲染与 Pages 直传，发布配置需要显式纳入版本管理并验证 Pages Functions 与 R2 binding 一起部署。

## 4. 目标发布协议

### 4.1 首期产物

以版本 `0.1.1` 为例：

```text
app/desktop/dist/
  mac-arm64/Downcity.app
  downcity-0.1.1.dmg
  downcity-0.1.1.dmg.blockmap
  downcity-0.1.1.zip
  downcity-0.1.1.zip.blockmap
  latest-mac.yml
```

DMG 是官网人工安装入口；ZIP 与 blockmap 是后续 electron-updater 的 macOS 更新入口。两者来自同一个已公证并已 staple 的 `.app`，不能分别重新构建。

### 4.2 R2 key 结构

目标 bucket 默认使用 `downcity`：

```text
releases/
  packages/
    macos/
      <version>/
        downcity-<version>.dmg
        downcity-<version>.dmg.blockmap
        downcity-<version>.dmg.sha256
        downcity-<version>.zip
        downcity-<version>.zip.blockmap
        latest-mac.yml
  manifests/
    macos-latest.json
```

版本化对象使用 `public, max-age=31536000, immutable`。latest manifest 使用 `public, max-age=60`，以短缓存换取稳定的发布切换。

### 4.3 latest manifest

```json
{
  "version": "0.1.1",
  "platform": "macos-arm64",
  "minimum_os": "12.0",
  "file": "downcity-0.1.1.dmg",
  "path": "releases/packages/macos/0.1.1/downcity-0.1.1.dmg",
  "blockmap_path": "releases/packages/macos/0.1.1/downcity-0.1.1.dmg.blockmap",
  "zip_file": "downcity-0.1.1.zip",
  "zip_path": "releases/packages/macos/0.1.1/downcity-0.1.1.zip",
  "zip_blockmap_path": "releases/packages/macos/0.1.1/downcity-0.1.1.zip.blockmap",
  "latest_mac_yml_path": "releases/packages/macos/0.1.1/latest-mac.yml",
  "sha256": "<dmg sha256>",
  "size": 123,
  "zip_sha256": "<zip sha256>",
  "zip_size": 123,
  "signed_by": "Developer ID Application: ...",
  "notarized": true,
  "published_at": "2026-09-09T00:00:00Z"
}
```

manifest 只允许引用同一版本目录内、符合白名单的文件。Homepage route 不接受 manifest 提供任意 bucket key。

### 4.4 发布原子性

发布不是 R2 事务，但通过提交顺序实现可解释的一致性：

1. 本地验证全部产物存在、版本一致、SHA-256 可计算、`.app` 已签名且 stapler validate 通过。
2. 上传全部版本化对象。
3. 对每个远端对象验证 metadata 中的 SHA-256；相同则跳过，不同则拒绝覆盖同一版本 key。
4. 仅当全部版本化对象成功后，最后上传 latest manifest。
5. latest manifest 上传失败时，旧 latest 继续有效；重跑 upload 阶段即可完成提交。

回滚不删除版本产物，只把经过校验的上一版本 manifest 重新写回 latest key。删除历史版本不属于发布流程。

## 5. 命令与交互设计

### 5.1 根命令

建议新增：

```text
pnpm desktop:publish          # 完整交互式发布
pnpm desktop:build:mac        # 选择版本并构建已签名 .app
pnpm desktop:notarize:mac     # 公证并 staple 已签名 .app
pnpm desktop:package:mac      # 从已公证 .app 生成 DMG/ZIP/update metadata
pnpm desktop:upload           # 只上传已存在且已校验的产物
pnpm desktop:release:test     # 发布脚本与路由契约测试
```

命名保持 Desktop release 与 npm package patch/build 分离，避免把 `desktop:publish` 误解为 npm registry 发布。

### 5.2 完整交互

```text
Current Desktop version: 0.1.0

Publish summary
  Platform: macOS arm64
  Version bump: selected during build (patch/minor/major/none)
  Code signing: required
  Apple notarization: required
  Artifacts: DMG + ZIP + blockmaps + latest-mac.yml
  R2 bucket: downcity
  Latest download URL: https://downcity.ai/download/macos

Continue with publish? [y/N]
```

确认后在 build 阶段选择：

```text
Version bump [patch] (patch/minor/major/none):
Updating Desktop version: 0.1.0 -> 0.1.1
```

默认回答是取消，避免误发布。完整 publish 必须运行在 TTY；拆分阶段可通过环境变量非交互执行，以便后续 CI 使用。

### 5.3 凭据

macOS：

```text
DOWNCITY_RELEASE_SIGNED_BY
DOWNCITY_NOTARY_PROFILE
APPLE_KEYCHAIN_PROFILE        # 兼容已有本机 profile 入口
APPLE_KEYCHAIN               # 可选，指定 keychain
CSC_NAME / CSC_LINK          # electron-builder 支持的签名凭据
```

R2：

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_R2_ACCESS_KEY_ID   # 也允许 AWS_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY # 也允许 AWS_SECRET_ACCESS_KEY
DOWNCITY_RELEASE_R2_BUCKET    # 默认 downcity
```

脚本只从进程环境、仓库 `.env`、`.env.local` 读取值，不记录凭据，不把凭据写入上传续传状态。`.env.local` 后加载并覆盖 `.env`。

## 6. 文件级改造方案

### 6.1 Desktop 构建配置

修改：

- `app/desktop/package.json`
  - 增加 release 分阶段命令。
  - 保留当前开发 `build` 与 `build:unpack` 语义。
- `app/desktop/electron-builder.yml`
  - 增加稳定 artifact name：`downcity-${version}.${ext}`。
  - macOS release 限定 arm64、开启 hardened runtime、配置 Developer ID identity。
  - 加入 entitlements 和 `notarize: false`，公证由独立脚本拥有。
  - 加入 generic publish URL `https://downcity.ai/download/macos`，使 electron-builder 生成 updater metadata。
  - 保留 Windows/Linux 声明，但本次不新增它们的发布入口。
- 新增 `app/desktop/electron-builder.mac.yml`
  - 只承载 macOS 平台依赖裁剪，避免平台二进制进入 arm64 安装包。
- 新增 `app/desktop/resources/entitlements.mac.plist`
  - 仅声明 Electron/原生模块实际需要的权限；实现前通过签名与运行测试确认最小集合。
- 新增 `app/desktop/scripts/build-mac-app.mjs`
  - 清理 stale `dist/mac-arm64`、构建 icon、执行生产构建、签名、验证运行时文件。

### 6.2 根发布脚本

新增：

- `scripts/desktop-release-version.sh`
- `scripts/build-desktop-mac-release.sh`
- `scripts/notarize-desktop-mac-app.sh`
- `scripts/package-desktop-mac-release.sh`
- `scripts/publish-desktop-release.sh`
- `scripts/publish-desktop-release-to-r2.sh`
- `scripts/r2-multipart-upload.mjs`

修改根 `package.json`，仅增加上述脚本入口和 `@aws-sdk/client-s3` 开发依赖。R2 上传器属于仓库发布基础设施，不进入任何 SDK/CLI/Desktop runtime package。

### 6.3 Homepage 下载网关

新增 Pages Functions：

- `homepage/functions/download/macos.js`
  - 读取 latest manifest，并 302 到版本化 DMG 路由。
- `homepage/functions/download/macos/latest.json.js`
  - 返回 latest manifest，支持 GET/HEAD、ETag 与短缓存。
- `homepage/functions/download/macos/[version]/[filename].js`
  - 严格校验 semver 与 Downcity artifact 文件名，从 R2 流式返回版本文件。
- `homepage/functions/download/macos/latest-mac.yml.js`
  - 读取版本化 updater metadata，并把相对 artifact URL 改写到版本路由。

Pages 配置：

- 将 Homepage Wrangler 配置纳入版本管理，声明 `RELEASES -> downcity` R2 binding。
- 调整 `.gitignore`，只对白名单配置解除忽略，不放开所有本地 Wrangler 文件。
- 更新 `scripts/deploy-homepage.sh`，确保从 `homepage` 配置上下文部署 Pages Functions，而不只上传静态 `build/client`。

### 6.4 Homepage 用户入口

首期增加三处一致入口：

1. 顶部导航增加“下载 / Download”，目标固定为 `/download/macos`。
2. 首页收尾 CTA 增加“下载 macOS Desktop”，保留“快速开始”和 GitHub，不把 Desktop 替代 SDK/CLI 主路径。
3. `/start` 的 macOS 平台卡片同时展示：
   - 下载 Desktop（Apple Silicon，macOS 12+）。
   - 通过 npm 安装 CLI。

Windows/Linux tab 只展示 CLI，不展示尚未正式发布的 Desktop 安装包。界面文案不声称自动更新；只说明下载、拖入 Applications 与首次启动。

## 7. 失败语义与安全

- 非 macOS 环境执行签名、公证或 macOS release build 时明确失败。
- 缺少签名 identity、notary profile、Xcode tools 或 R2 凭据时在有副作用前失败。
- 未公证或 stapler validate 失败的 `.app` 不允许封装、上传。
- 任一 required artifact 缺失时拒绝上传。
- manifest 的版本必须等于 `app/desktop/package.json` 版本。
- 同一版本 key 已存在且 SHA-256 不同视为不可变性冲突，禁止覆盖。
- multipart 失败保留不含凭据的本地续传状态；成功后原子删除状态文件。
- 新 manifest 提交失败不影响旧版本下载。
- Homepage 对未知版本、非法文件名、缺失对象统一返回 404；bucket binding 缺失返回 500；manifest 损坏返回 502。
- 下载响应设置 `X-Content-Type-Options: nosniff`，文件名经过白名单而不是字符串清洗后放行。

## 8. 测试与验收

### 8.1 自动测试

- 版本 helper：patch/minor/major/none、非法 semver、非交互默认行为。
- 发布编排：TTY 校验、默认取消、阶段顺序、凭据前置检查。
- 打包契约：artifact name、macOS arm64、hardened runtime、generic feed、独立 notarization。
- R2 uploader：单文件、multipart 计划、断点恢复、重试、同内容跳过、不同内容拒绝覆盖、状态原子写入。
- R2 publisher：required artifact、manifest 字段、SHA-256、latest 最后提交。
- Homepage Functions：GET/HEAD、方法限制、semver/filename 白名单、404/500/502、headers、latest redirect、YAML URL 改写。
- Homepage UI：中英文下载文案与 `/download/macos` 链接契约。

### 8.2 实机验收

1. `pnpm desktop:build:mac` 产出可启动的 `Downcity.app`。
2. `codesign --verify --deep --strict` 通过。
3. Apple notarization 成功，`xcrun stapler validate` 通过。
4. DMG 可挂载，应用可拖入 Applications 并首次启动。
5. ZIP 解压后应用签名和启动正常。
6. 上传中断后再次执行可续传，不重复上传已确认 parts。
7. `HEAD /download/macos` 不下载正文，`GET` 能获得最新版 DMG。
8. 历史版本 URL 长期有效，latest 在 manifest 提交后切换到新版本。
9. Homepage 桌面端与移动端下载入口可见且不会影响现有 CLI 快速开始。

### 8.3 实现后的验证顺序

```text
发布脚本单元测试
  -> Desktop typecheck/test
  -> unsigned release 构建验证（只验证结构，不冒充签名成功）
  -> Homepage typecheck/test/build
  -> git diff --check
  -> 签名、公证、DMG/ZIP 实机发布验收
```

Desktop private app 版本由 release build 递增；本次没有 npm package 对外 API 变化，因此不运行 SDK package patch bump。若实现过程中实际修改了公开 package，则按受影响 package 单独执行对应 patch build。

## 9. 实施顺序

### 阶段 A：发布基础设施

完成版本 helper、签名构建、公证、封装、R2 uploader、publisher 和契约测试。先用临时路径与 mock S3 验证，不上传正式 latest manifest。

### 阶段 B：下载网关

完成 R2 binding、Pages Functions 与路由测试。使用测试 manifest 验证 GET/HEAD、缓存与错误语义。

### 阶段 C：Homepage 入口

完成导航、首页 CTA、Start 平台卡片和中英文文案，执行 Homepage 构建与响应式检查。

### 阶段 D：首次正式发布

使用真实 Developer ID 与 notary profile 完成签名、公证和封装；先上传版本化对象并逐项校验，再提交 latest manifest，最后验证 `https://downcity.ai/download/macos`。

## 10. 明确不做

- 不在本次实现 Desktop 自动检查、后台下载、延迟安装或“关于”页更新状态机。
- 不引入 D1 下载统计、IP/User-Agent 记录或下载量 UI。
- 不发布 Windows NSIS/portable 或 Linux AppImage/deb。
- 不引入 beta/nightly channel。
- 不把 release 上传能力放进 Downcity SDK 或 CLI 公共 API。
- 不让 Homepage 直接访问公开 R2 URL；用户入口统一经过 downcity.ai 下载网关。
- 不自动提交、打 Git tag、创建 GitHub Release 或部署 Homepage，除非另行明确授权。

## 11. 待确认决策

建议按以下默认值实施：

1. 首期平台：仅 macOS arm64。
2. R2 bucket：`downcity`，Homepage binding 名为 `RELEASES`。
3. 最低系统：macOS 12.0，与 Duobox 当前发布口径一致；实机构建若依赖要求更高，以验证结果上调。
4. 安装包命名：`downcity-<version>.dmg` / `.zip`。
5. 下载入口：导航、首页 CTA、`/start` 三处同时加入。
6. 首期生成 updater-compatible 资产，但不实现应用内自动更新。
7. 不包含下载统计。

确认本设计后再开始修改代码。实施时将避开工作区中现有的 Session、Agent、Desktop UI 等未提交改动，只修改本设计列出的 release、Homepage 下载入口与必要构建配置文件；若 `app/desktop/package.json` 的并行改动尚未收口，会先基于当前内容做最小合并，不覆盖已有变更。

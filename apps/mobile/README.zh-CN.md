# Codex Tracker 原生移动端查看器

iOS 和 Android 应用是现有 Codex Tracker 仪表盘的原生只读入口，用于查看个人/团队用量、成员、
会话和已登记设备。它们**不会**扫描手机、采集或上传用量、批准或撤销设备，也不会讲解如何安装
桌面菜单栏追踪器。

未提供本地服务配置时，两个应用都会进入带明显标识、无需凭据的演示模式。实时模式通过 Clerk
认证并调用现有的 Convex 认证查询，不会新增移动端 API，也不会修改上传 wire contract。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `fixtures/dashboard-demo.json` | 供预览和原生测试共用的确定性数据 |
| `ios` | SwiftUI、Swift Charts、XCTest 与 XCUITest 应用 |
| `android` | Kotlin、Jetpack Compose、JUnit 与 Compose UI 测试应用 |
| `../../artifacts/mobile` | 被 Git 忽略的本地构建和测试导出目录 |

每个应用都有五个原生底部页签：个人、团队、成员、设备和设置。个人与团队页提供区间选择、用量
指标、每日/模型/来源摘要和最近会话；成员和设备页只读；设置仅包含外观、语言、账号、隐私与
应用信息。

## 构建与 E2E 流水线

在仓库根目录使用 Node 22+ 和 pnpm 11.15.1 执行以下命令。先安装下文的原生工具链；
Android E2E 测试前需启动 Android 仿真器。

```bash
pnpm mobile:setup --local            # 设置开发 Clerk issuer，并部署开发 Convex 后端
pnpm mobile:build --local            # 两端均使用开发 Clerk + 开发 Convex
pnpm mobile:e2e --local              # 对开发配置的应用运行两端原生测试
pnpm mobile:e2e --local --deploy     # 先部署开发后端，再执行两端测试
pnpm mobile:build --local --platform ios
pnpm mobile:e2e --local --platform android
pnpm mobile:build --demo             # 无凭据演示模式（不传环境参数时也是该模式）
pnpm mobile:test                     # 无需服务的流水线回归测试，CI 也会执行
```

`--local` 指 Clerk 和 Convex 的**云端开发实例**，模拟器和真机都可以访问；Clerk 不提供
自托管的本地服务器。命令优先读取 `apps/mobile/.env.local`，仅在文件不存在时回退到
`apps/dashboard/.env.local`。需要独立的移动端开发部署时，复制 `apps/mobile/.env.example`。
必填项是 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`（`pk_test_...`）、`CONVEX_DEPLOYMENT`
（`dev:<名称>`）和对应的 `NEXT_PUBLIC_CONVEX_URL` 云端 URL。

`mobile:setup --local` 和 `--local --deploy` 从 publishable key 推导 issuer，在该开发部署
设置 **CLERK_JWT_ISSUER_DOMAIN**，再执行带类型检查的 `convex dev --once`，同时部署当前
后端授权加固。需要已有开发部署和 Convex CLI 登录，或仅用于该部署的开发 deploy key。
Clerk Native API、原生应用登记和 session claims 按下文在控制台配置一次；构建命令不会创建
Clerk 实例或修改 Clerk 设置。
若已有 issuer 指向其他 Clerk 实例，setup 会拒绝覆盖。为未配置部署新增 issuer 后若部署失败，
会移除刚添加的值；回滚失败会明确报错。

要编译使用生产环境的 Release，创建被忽略的 `apps/mobile/.env.release`，填入 `pk_live_...`、
`CONVEX_DEPLOYMENT=prod:<名称>` 及匹配的云端 URL，然后执行：

```bash
pnpm mobile:build --release
```

生产配置仅用于显式 Release 构建。Release 不会回退到开发配置，E2E/setup 拒绝 `--release`。
执行命令前会校验 key 类型、部署名、URL、issuer 和 deploy key 是否匹配。子进程会清除继承的
服务凭据，原生构建仅接收已验证的公开 key 和 URL。**所有移动端命令都不会部署生产后端**；
分发生产客户端前需单独部署生产后端变更。

Release 编译产物是**未签名 iOS 真机 `.app` 和未签名 Android APK/AAB**。分发签名、
provisioning、IPA 导出及 TestFlight/Play 上传属于独立发布步骤。开发 iOS Simulator 应用使用
Xcode 的 ad hoc “Sign to Run Locally” 签名，让 Clerk 可以访问 Keychain；模拟器签名不需要
Apple Developer 团队。Android Debug 产物使用 debug 签名。
Android Release 不包含演示数据文件，必须使用真实服务，且会忽略演示模式 intent 参数。

用 `--env-file PATH` 指定 dotenv 文件（含 CI 创建的 secret 文件），`--dry-run` 仅查看命令，
不会写配置、构建或部署；`--destination 'platform=iOS Simulator,name=你的模拟器,OS=latest'`
可选择其他 iOS 模拟器。环境文件相对路径从仓库根目录解析。构建会生成被忽略的
`artifacts/mobile/<demo|local|release>/Native.xcconfig`；iOS 产物在该目录的
`ios/DerivedData/Build/Products`，Android 复制产物在 `android/`。Gradle 原始输出目录会被
不同模式共用，安装时请使用按环境复制的 APK。
pnpm 命令包含 Node 的 `--` 分隔符，避免 Node 提前加载流水线的 `--env-file`；直接调用时也应
保留：`node -- apps/mobile/scripts/mobile.mjs ...`。

现有 UI 测试即使运行开发配置的应用，也会显式使用**演示数据**。E2E 通过表示原生导航与只读
行为通过验证；完整 Clerk 登录与团队访问需另用开发账号测试。测试不内置登录凭据或 token。

为 iPhone 17 Pro Max 构建使用真实开发环境的应用，不启动演示测试：

```bash
pnpm mobile:build --local --platform ios \
  --destination 'platform=iOS Simulator,name=iPhone 17 Pro Max,OS=latest'
```

将 `artifacts/mobile/local/ios/DerivedData/Build/Products/Debug-iphonesimulator/CodexTracker.app`
安装到该模拟器，正常启动且不传入 `--demo`。使用开发账号登录后即可验证真实 Clerk 身份认证
与 Convex 数据；此次启动不会使用演示数据。

在 Android 上进行同样的真实环境验证时，先启动模拟器，并使用 `adb devices` 显示的序列号：

```bash
pnpm mobile:build --local --platform android
adb -s emulator-5554 install -r artifacts/mobile/local/android/codex-tracker-debug.apk
adb -s emulator-5554 shell am start -S -n dev.chenli.codextracker/.MainActivity
```

正常启动会使用开发环境服务。在模拟器中完成登录后，检查个人、团队、成员、设备、设置页面，
以及重启应用后的登录状态恢复。真实环境验证不要传入 `dev.chenli.codextracker.DEMO_MODE`
intent 参数，也不要运行 `DemoTestRunner`。APK 仅包含公开服务配置，登录会话保留在模拟器内。

## iOS

要求：

- Xcode 26 或更高版本，以及 iOS Simulator runtime
- 最低部署版本 iOS 17
- 仅在修改 `project.yml` 时需要 XcodeGen 2.46 或更高版本；生成后的 Xcode 项目已提交

仓库中的占位配置会启动演示模式。若直接在 Xcode 启用实时模式，复制并填写以下配置
（根目录流水线会自动生成配置）：

```bash
cd apps/mobile/ios
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

xcconfig 会把 `//` 视为注释起始符，因此 URL 必须沿用示例中的转义形式：

```text
CLERK_PUBLISHABLE_KEY = pk_test_replace_me
CONVEX_URL = https:/$()/your-deployment.convex.cloud
CLERK_FRONTEND_API_HOST = your-instance.clerk.accounts.dev
```

在当前机器已安装的模拟器上构建与测试：

```bash
cd apps/mobile/ios
xcodebuild -project CodexTracker.xcodeproj -scheme CodexTracker \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=latest' \
  -derivedDataPath DerivedData test
xcodebuild -project CodexTracker.xcodeproj -scheme CodexTracker \
  -sdk iphonesimulator -configuration Debug \
  -derivedDataPath DerivedData build
```

只有修改 `project.yml` 后才运行 `xcodegen generate`，并审查、提交生成的项目 diff。

XCUITest target 会用仅供测试的演示参数启动并遍历原生界面。模拟器 `.app` 可用于手动冒烟测试；
下文的完整 E2E products 压缩包包含 `test-without-building` 所需的测试 runner 和 framework。
若要安装到真机或生成 IPA，还需要你的 Apple Developer 团队、bundle 注册、签名证书和
provisioning profile；这些账号变更不属于本次工作范围。

## Android

仓库会提交 Gradle wrapper，因此不要求安装 Android Studio 或全局 Gradle。在 Apple Silicon
macOS 上可使用这套精简命令行环境：

```bash
brew install openjdk@17 android-commandlinetools

export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:/opt/homebrew/opt/openjdk@17/bin:$PATH"

sdkmanager --sdk_root="$ANDROID_HOME" \
  'cmdline-tools;latest' \
  'platform-tools' \
  'platforms;android-37.0' \
  'build-tools;37.0.0' \
  'emulator' \
  'system-images;android-37.0;google_apis;arm64-v8a'
sdkmanager --sdk_root="$ANDROID_HOME" --licenses

avdmanager create avd --force \
  --name CodexTracker_API_37 \
  --package 'system-images;android-37.0;google_apis;arm64-v8a' \
  --device pixel_9
```

`ANDROID_HOME` 是主要 SDK 设置；为了兼容仍会读取旧变量的命令行工具，`ANDROID_SDK_ROOT` 也
指向同一路径。`PATH` 中应让 SDK 根目录下的 `platform-tools` 排在单独安装的 `adb` 前面。

当前工作站已准备好 ARM64 JDK 17、platform/build tools 37、emulator 37，以及名为
`CodexTracker_API_37`、已验证可启动的 Pixel 9 API-37 AVD；没有修改 shell profile。

若要启用本地实时模式，创建被忽略的 properties 文件并替换占位内容：

```bash
cd apps/mobile/android
cp local.properties.example local.properties
```

```properties
sdk.dir=/Users/your-name/Library/Android/sdk
CODEX_TRACKER_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CODEX_TRACKER_CONVEX_URL=https://your-deployment.convex.cloud
```

构建 debug APK 并运行单元测试：

```bash
cd apps/mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
./gradlew testDebugUnitTest assembleDebug
```

在另一个终端启动模拟器，等待 Android 启动完成，再运行原生 UI 测试：

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

"$ANDROID_HOME/emulator/emulator" -avd CodexTracker_API_37 -no-snapshot -no-boot-anim \
  > /tmp/codex-tracker-emulator.log 2>&1 &
"$ANDROID_HOME/platform-tools/adb" wait-for-device
"$ANDROID_HOME/platform-tools/adb" shell \
  'until [ "$(getprop sys.boot_completed)" = "1" ]; do sleep 1; done'

cd apps/mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" \
ANDROID_SDK_ROOT="$HOME/Library/Android/sdk" \
./gradlew connectedDebugAndroidTest
```

## 启用实时登录

演示模式无需账号或网络。实时模式需要所有者完成 Clerk 与 Convex 配置：

1. 为相应实例启用 Clerk Native API。Clerk 明确说明该设置会改变 bot protection 行为，因此应
   先评估安全取舍。
2. Android 登记 namespace `android_app`、package `dev.chenli.codextracker` 及构建所用签名
   证书的 SHA-256 fingerprint（可通过 `./gradlew signingReport` 查看）。debug 证书仅登记在
   开发实例；生产使用 release/Play 签名证书。iOS 用 Apple App ID Prefix 和 bundle ID
   `dev.chenli.codextracker` 登记 Native Application。仓库 entitlements 已通过
   `webcredentials:$(CLERK_FRONTEND_API_HOST)` 配置 Associated Domains，由流水线按环境填值。
3. 启用 Clerk 当前的 **Convex integration**。在 *Sessions → Claims* 中保留集成生成的
   `aud: convex` 映射，并加入 `docs/clerk-jwt-template.json` 中的组织/用户映射。官方原生桥接
   请求的是 Clerk 原生 session token，无法选择仓库中旧的、名为 `convex` 的 JWT template；
   如果实例只有旧 template，必须先把其映射复制到 session claims，才能测试移动端实时模式。
4. 执行 `pnpm mobile:setup --local` 设置 `packages/backend/convex/auth.config.ts` 读取的
   `CLERK_JWT_ISSUER_DOMAIN` 并部署开发后端。其值与 Clerk 当前指南中的
   `CLERK_FRONTEND_API_URL` 相同；本仓库沿用已有变量名。
5. 只在上述被忽略的本地文件中填写 publishable key 和 Convex deployment URL。

不要把 Clerk secret key 放入任一应用。原生客户端只使用 publishable key，由平台 SDK 保存
Clerk 会话，并且只把 token 发送到预期的 Clerk/Convex endpoint。客户端从 Clerk 发现成员关系、
激活所选组织、等待刷新后的组织 claim，再执行幂等的用户/当前组织初始化，并且只订阅现有用户、
组织与用量函数。token 不会加入用量 payload、写入日志或存入应用自有存储。

现有 Convex issuer 和 JWT-template 约束见仓库的[管理员部署指南](../../docs/ADMIN_DEPLOY.zh-CN.md)。
请同时参照 Clerk 官方 [iOS 集成](https://clerk.com/docs/ios/reference/native-mobile/integrations/convex)
与 [Android 集成](https://clerk.com/docs/android/reference/native-mobile/integrations/convex)。
Clerk 账号设置独立于编译；开发后端可通过 `mobile:setup --local` 或 `--local --deploy` 部署。
直接 Xcode/Gradle Debug 构建可读取 `Config/Local.xcconfig` / `local.properties`；Release
必须使用根目录流水线验证后的配置，且不会读取开发配置文件。使用根目录流水线可完整校验
Clerk/Convex 环境配对。

## 数据与隐私约束

- 用量时间戳在按本地日期展示分组前始终保留 UTC 毫秒。
- 查询区间拆成不超过 60 天的分块，低于后端 62 天上限。
- 使用与网页仪表盘相同的模型名称规则排除非 OpenAI 行，同时保留可归因于 Codex 的 `unknown`。
- 费用直接展示服务端现有 `usd` 值；移动端不会重新定价或上传。
- 应用不申请 transcript、存储或文件系统权限，也不提供采集、onboarding、邀请、设备授权或撤销
  操作。

架构取舍见 [ADR-001](../../docs/decisions/001-native-mobile-viewers.zh-CN.md)，验收标准见
[功能规格](../../SPEC-mobile-app.md)。

## 本地验证快照

- iOS：在运行 iOS 26.5 的 iPhone 17 Pro 模拟器上，41 个 XCTest 与 2 个 XCUITest 流程通过。
- Android：在 API 37 ARM64 仿真器上，33 个单元测试与 3 个 Compose E2E 流程通过；lint 为
  0 个错误，两个 debug APK 均通过签名校验。
- `--local` 流水线同样通过 iOS 41 + 2、Android 33 + 3 项测试，并验证了开发后端部署。
  测试使用演示数据；完整 Clerk 实时登录、API 26 真机表现、TalkBack/大字体手动测试、商店签名
  和生产部署需另行完成。

## 本地产物

已验证的导出会复制到被忽略的 `artifacts/mobile` 目录，避免凭据、缓存或大型二进制进入 Git：

| 文件 | 用途 |
| --- | --- |
| `android/codex-tracker-debug.apk` | 可安装的 debug/演示应用 |
| `android/codex-tracker-debug-androidTest.apk` | Compose instrumentation 测试 |
| `android/codex-tracker-android-e2e-report.zip` | 已通过的 Android E2E HTML 报告 |
| `ios/CodexTracker-iOS-Simulator-26.5.zip` | 可安装的模拟器 `.app` |
| `ios/CodexTracker-iOS-E2E-Products-26.5.zip` | 完整 app、单元/UI 测试 runner、framework 与 `.xctestrun` |
| `ios/CodexTracker-iOS-26.5.xcresult.zip` | XCTest/XCUITest 通过的结果凭证 |
| `android/codex-tracker-demo.png`、`ios/*.png` | 已检查的仿真器/模拟器截图 |
| `SHA256SUMS` | 所有导出文件的校验值 |

先在仓库根目录校验全部产物：

```bash
shasum -a 256 -c artifacts/mobile/SHA256SUMS
```

启动上文配置的 Android 仿真器后，安装并启动演示 APK：

```bash
SDK_ADB="$HOME/Library/Android/sdk/platform-tools/adb"
"$SDK_ADB" install -r artifacts/mobile/android/codex-tracker-debug.apk
"$SDK_ADB" shell am start -S \
  -n dev.chenli.codextracker/.MainActivity \
  --ez dev.chenli.codextracker.DEMO_MODE true
```

重新执行已打包的 Android E2E 测试：

```bash
SDK_ADB="$HOME/Library/Android/sdk/platform-tools/adb"
"$SDK_ADB" install -r artifacts/mobile/android/codex-tracker-debug-androidTest.apk
"$SDK_ADB" shell am instrument -w \
  dev.chenli.codextracker.test/dev.chenli.codextracker.DemoTestRunner
```

列出可用的 iOS 模拟器，启动一台并安装演示应用：

```bash
xcrun simctl list devices available
ios_app_dir=$(mktemp -d /tmp/codex-tracker-app.XXXXXX)
ditto -x -k artifacts/mobile/ios/CodexTracker-iOS-Simulator-26.5.zip "$ios_app_dir"
xcrun simctl boot 'iPhone 17 Pro' 2>/dev/null || true
open -a Simulator
xcrun simctl install booted "$ios_app_dir/CodexTracker.app"
xcrun simctl launch booted dev.chenli.codextracker --demo --reset-preferences
```

如本机没有该型号，请换成 `simctl` 输出中的设备名。无需重新编译即可重跑全部 XCTest 与
XCUITest；必须整体解压完整 E2E products，以保持相对 `__TESTROOT__` 路径有效：

```bash
ios_e2e_dir=$(mktemp -d /tmp/codex-tracker-e2e.XXXXXX)
ditto -x -k artifacts/mobile/ios/CodexTracker-iOS-E2E-Products-26.5.zip "$ios_e2e_dir"
xcodebuild test-without-building \
  -xctestrun "$ios_e2e_dir/Products/CodexTracker_iphonesimulator26.5-arm64.xctestrun" \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=latest'
```

`.xcresult.zip` 是已验证运行的不可变结果凭证；代码发生变化后，应使用前文的
`xcodebuild ... test` 命令从源码重新构建测试。

这些是开发测试产物，不是已签名的 App Store 或 Play Store 发布版本。

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

## iOS

要求：

- Xcode 26 或更高版本，以及 iOS Simulator runtime
- 最低部署版本 iOS 17
- 仅在修改 `project.yml` 时需要 XcodeGen 2.46 或更高版本；生成后的 Xcode 项目已提交

仓库中的占位配置会启动演示模式。若要在本机启用实时模式，复制被忽略的配置文件并替换两个值：

```bash
cd apps/mobile/ios
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

xcconfig 会把 `//` 视为注释起始符，因此 URL 必须沿用示例中的转义形式：

```text
CLERK_PUBLISHABLE_KEY = pk_test_replace_me
CONVEX_URL = https:/$()/your-deployment.convex.cloud
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
2. 把 `dev.chenli.codextracker` 注册为 Android package/application ID。iOS 端则需用 Apple
   App ID Prefix 与该 bundle ID 注册 Native Application，并添加 Associated Domains capability：
   `webcredentials:<你的 Clerk Frontend API 主机>`。
3. 启用 Clerk 当前的 **Convex integration**。在 *Sessions → Claims* 中保留集成生成的
   `aud: convex` 映射，并加入 `docs/clerk-jwt-template.json` 中的组织/用户映射。官方原生桥接
   请求的是 Clerk 原生 session token，无法选择仓库中旧的、名为 `convex` 的 JWT template；
   如果实例只有旧 template，必须先把其映射复制到 session claims，才能测试移动端实时模式。
4. 把 `packages/backend/convex/auth.config.ts` 使用的 Convex issuer 设为集成显示的 Clerk
   Frontend API URL，然后有意识地部署认证/后端变更。
5. 只在上述被忽略的本地文件中填写 publishable key 和 Convex deployment URL。

不要把 Clerk secret key 放入任一应用。原生客户端只使用 publishable key，由平台 SDK 保存
Clerk 会话，并且只把 token 发送到预期的 Clerk/Convex endpoint。客户端从 Clerk 发现成员关系、
激活所选组织、等待刷新后的组织 claim，再执行幂等的用户/当前组织初始化，并且只订阅现有用户、
组织与用量函数。token 不会加入用量 payload、写入日志或存入应用自有存储。

现有 Convex issuer 和 JWT-template 约束见仓库的[管理员部署指南](../../docs/ADMIN_DEPLOY.zh-CN.md)。
启用 Native API、注册原生应用和修改 Apple capability 都是所有者操作，本次构建不会自动执行。
在把原生团队实时访问视为安全之前，还必须部署本分支包含的后端授权加固；本地构建流程不会执行
任何部署。

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
- 下列演示模式构建与导出产物已完整验证。实时 Clerk/Convex 登录、API 26 真机表现、TalkBack/
  大字体手动测试、商店签名和后端部署依赖所有者环境，本次未执行。

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

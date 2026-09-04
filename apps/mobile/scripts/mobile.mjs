import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv, parseArgs } from 'node:util';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function parseOptions(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    local: { type: 'boolean' }, release: { type: 'boolean' }, demo: { type: 'boolean' },
    deploy: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
    platform: { type: 'string', default: 'all' }, 'env-file': { type: 'string' },
    destination: { type: 'string', default: 'platform=iOS Simulator,name=iPhone 17 Pro,OS=latest' },
  } });
  const action = positionals[0] ?? 'build';
  if (values.help) return { help: true };
  if (positionals.length > 1 || !['build', 'e2e', 'setup'].includes(action)) throw new Error('Use build, e2e, or setup.');
  if (['local', 'release', 'demo'].filter(k => values[k]).length > 1) throw new Error('Choose one environment: --local, --release, or --demo.');
  const mode = values.local ? 'local' : values.release ? 'release' : 'demo';
  if (mode === 'release' && action !== 'build') throw new Error('--release is allowed only with build; E2E and setup cannot target production.');
  if ((values.deploy || action === 'setup') && mode !== 'local') throw new Error('Development deployment requires --local.');
  if (!['ios', 'android', 'all'].includes(values.platform)) throw new Error('--platform must be ios, android, or all.');
  return { ...values, action, mode, deploy: values.deploy || action === 'setup' };
}

export function resolveConfig(mode, env) {
  if (mode === 'demo') return { mode, publishableKey: '', convexURL: '', host: 'example.clerk.accounts.dev' };
  const type = mode === 'local' ? 'test' : 'live';
  const deploymentType = mode === 'local' ? 'dev' : 'prod';
  const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? '';
  if (!new RegExp(`^pk_${type}_[A-Za-z0-9+/=_-]+$`).test(publishableKey)) throw new Error(`${mode} requires a pk_${type}_ Clerk publishable key.`);
  const decoded = Buffer.from(publishableKey.slice(`pk_${type}_`.length), 'base64').toString('utf8');
  const host = decoded.slice(0, -1);
  if (!decoded.endsWith('$') || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(host)) throw new Error('Invalid Clerk publishable key hostname.');
  if ((type === 'test') !== host.endsWith('.clerk.accounts.dev')) throw new Error('Clerk hostname does not match the selected environment.');
  const deployment = env.CONVEX_DEPLOYMENT?.trim() ?? '';
  const match = deployment.match(new RegExp(`^${deploymentType}:([a-z0-9]+(?:-[a-z0-9]+)+)$`));
  if (!match) throw new Error(`${mode} requires CONVEX_DEPLOYMENT=${deploymentType}:<deployment-name>.`);
  const convexURL = env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? '';
  if (convexURL !== `https://${match[1]}.convex.cloud`) throw new Error('Convex URL must exactly match the selected deployment name.');
  const issuer = `https://${host}`;
  for (const field of ['CLERK_JWT_ISSUER_DOMAIN', 'CLERK_FRONTEND_API_URL']) {
    if (env[field] && env[field] !== issuer) throw new Error(`${field} does not match the Clerk publishable key.`);
  }
  if (env.CONVEX_SELF_HOSTED_URL || env.CONVEX_SELF_HOSTED_ADMIN_KEY) throw new Error('Use a Convex cloud development deployment for native devices.');
  if (env.CONVEX_DEPLOY_KEY && (!env.CONVEX_DEPLOY_KEY.startsWith(`${deployment}|`) || /[\s"'#]/.test(env.CONVEX_DEPLOY_KEY))) throw new Error('Convex deploy key must belong to the exact selected deployment and be a single unquoted value.');
  return { mode, publishableKey, convexURL, host, issuer, deployment };
}

export function cleanEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^(CLERK_|CONVEX_|NEXT_PUBLIC_|CODEX_TRACKER_|ORG_GRADLE_PROJECT_CODEX_TRACKER_)/.test(key)));
}

export function writeNativeConfig(config, output) {
  mkdirSync(output, { recursive: true });
  const path = join(output, 'Native.xcconfig');
  writeFileSync(path, [
    `CODEX_TRACKER_ENVIRONMENT = ${config.mode}`,
    `CLERK_PUBLISHABLE_KEY = ${config.publishableKey}`,
    `CONVEX_URL = ${config.convexURL.replace('https://', 'https:/$()/')}`,
    `CLERK_FRONTEND_API_HOST = ${config.host}`,
    '',
  ].join('\n'), { mode: 0o600 });
  return path;
}

export function buildCommands(options, repo, output, xcconfig) {
  const commands = [];
  if (options.platform !== 'android') {
    const release = options.mode === 'release';
    commands.push({ command: 'xcodebuild', cwd: join(repo, 'apps/mobile/ios'), args: [
      '-project', 'CodexTracker.xcodeproj', '-scheme', 'CodexTracker',
      '-configuration', release ? 'Release' : 'Debug', '-xcconfig', xcconfig,
      '-derivedDataPath', join(output, 'ios/DerivedData'),
      ...(release ? ['-sdk', 'iphoneos', '-destination', 'generic/platform=iOS'] : ['-destination', options.destination]),
      // Keep the project's Simulator signing settings: Clerk needs its Keychain entitlement.
      ...(release ? ['CODE_SIGNING_ALLOWED=NO'] : []),
      options.action === 'e2e' ? 'test' : 'build',
    ] });
  }
  if (options.platform !== 'ios') {
    commands.push({ command: './gradlew', cwd: join(repo, 'apps/mobile/android'), args: [
      '--no-daemon', '--console=plain',
      ...(options.mode === 'release' ? ['bundleRelease', 'assembleRelease'] : [
        'testDebugUnitTest', 'assembleDebug', 'assembleDebugAndroidTest',
        ...(options.action === 'e2e' ? ['connectedDebugAndroidTest'] : []),
      ]),
    ] });
  }
  return commands;
}

export function exportAndroidArtifacts(mode, repo, output) {
  const androidOutput = join(repo, 'apps/mobile/android/app/build/outputs');
  const target = join(output, 'android');
  mkdirSync(target, { recursive: true });
  const files = mode === 'release' ? [
    ['apk/release/app-release-unsigned.apk', 'codex-tracker-release-unsigned.apk'],
    ['bundle/release/app-release.aab', 'codex-tracker-release-unsigned.aab'],
  ] : [
    ['apk/debug/app-debug.apk', 'codex-tracker-debug.apk'],
    ['apk/androidTest/debug/app-debug-androidTest.apk', 'codex-tracker-debug-androidTest.apk'],
  ];
  for (const [source, name] of files) cpSync(join(androidOutput, source), join(target, name));
}

function run(command, args, cwd, env, capture = false) {
  return new Promise((res, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (capture) {
      child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
      child.stderr.resume();
    }
    child.on('error', () => reject(new Error(`Unable to start ${command}; check the native toolchain.`)));
    child.on('close', (code, signal) => code === 0 ? res(output) : reject(new Error(`${command} failed (${signal ?? code}).`)));
  });
}

export async function syncDevelopmentIssuer(issuer, convex) {
  const name = 'CLERK_JWT_ISSUER_DOMAIN';
  const previous = (await convex(['env', 'get', name], true)).trim();
  if (previous && previous !== issuer) throw new Error('Development backend already trusts a different Clerk issuer. Select its matching Clerk instance or intentionally change that deployment separately.');
  if (!previous) await convex(['env', 'set', name, issuer]);
  try {
    await convex(['dev', '--once', '--codegen', 'disable', '--typecheck', 'enable']);
  } catch (error) {
    if (!previous) {
      try { await convex(['env', 'remove', name]); }
      catch { throw new Error('Development deployment failed and its newly set Clerk issuer could not be removed. Inspect CLERK_JWT_ISSUER_DOMAIN on the development deployment before retrying.'); }
    }
    throw error;
  }
}

async function deployDevelopment(config, sourceEnv) {
  // A separate env file prevents dashboard .env files or ambient prod keys selecting the target.
  const dir = mkdtempSync(join(tmpdir(), 'codex-mobile-convex-'));
  try {
    const envFile = join(dir, '.env.local');
    writeFileSync(envFile, `CONVEX_DEPLOYMENT=${config.deployment}\n` +
      (sourceEnv.CONVEX_DEPLOY_KEY ? `CONVEX_DEPLOY_KEY=${sourceEnv.CONVEX_DEPLOY_KEY}\n` : ''), { mode: 0o600 });
    const env = cleanEnvironment(process.env);
    const cwd = join(root, 'apps/dashboard');
    await syncDevelopmentIssuer(config.issuer, (args, capture) =>
      run('pnpm', ['exec', 'convex', ...args, '--env-file', envFile], cwd, env, capture));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function main(args) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('mobile.mjs build|e2e|setup [--local|--demo|--release] [--platform ios|android|all] [--env-file PATH] [--deploy] [--dry-run] [--destination XCODE_DESTINATION]\nDefault: credential-free demo. --deploy and setup deploy only development. --release builds unsigned production artifacts for separate signing; never deploys production.');
    return;
  }
  let sourceEnv = {};
  let envFile;
  if (options.mode !== 'demo') {
    envFile = resolve(root, options['env-file'] ?? `apps/mobile/.env.${options.mode === 'local' ? 'local' : 'release'}`);
    if (!options['env-file'] && options.mode === 'local' && !existsSync(envFile)) envFile = join(root, 'apps/dashboard/.env.local');
    if (!existsSync(envFile)) throw new Error(`Missing ${envFile}. Copy apps/mobile/.env.example and configure the selected environment.`);
    sourceEnv = parseEnv(readFileSync(envFile, 'utf8'));
  }
  const config = resolveConfig(options.mode, sourceEnv);
  const output = join(root, 'artifacts/mobile', options.mode);
  const commands = options.action === 'setup' ? [] : buildCommands(options, root, output, join(output, 'Native.xcconfig'));
  console.log(`Mobile ${options.action}: ${options.mode}; ${options.platform}.`);
  if (envFile) console.log(`Configuration: ${envFile}`);
  if (options['dry-run']) {
    if (options.deploy) console.log('Would set the development Clerk issuer and run convex dev --once on the validated development deployment.');
    for (const c of commands) console.log(`${c.command} ${c.args.join(' ')}`);
    return;
  }
  if (options.deploy) await deployDevelopment(config, sourceEnv);
  writeNativeConfig(config, output);
  if (options.action === 'setup') {
    console.log('Development backend deployed. Clerk Native API, native application registration, and Convex session claims must be configured in the matching Clerk development instance. See apps/mobile/README.md.');
    return;
  }
  const env = cleanEnvironment(process.env);
  // Only public, validated configuration reaches native build tools.
  Object.assign(env, {
    ORG_GRADLE_PROJECT_CODEX_TRACKER_ENVIRONMENT: config.mode,
    ORG_GRADLE_PROJECT_CODEX_TRACKER_CLERK_PUBLISHABLE_KEY: config.publishableKey,
    ORG_GRADLE_PROJECT_CODEX_TRACKER_CONVEX_URL: config.convexURL,
  });
  for (const c of commands) await run(c.command, c.args, c.cwd, env);
  if (options.platform !== 'ios') exportAndroidArtifacts(options.mode, root, output);
  console.log(`Native ${options.action} complete (${options.mode}). Products: ${output}`);
  if (options.action === 'e2e') console.log('UI tests exercise deterministic demo fixtures. Live account sign-in is a separate check.');
  if (options.mode === 'release') console.log('Production configuration selected. Artifacts are unsigned and require distribution signing before external release.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}

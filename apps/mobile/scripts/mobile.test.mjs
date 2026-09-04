import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseOptions, resolveConfig, buildCommands, cleanEnvironment, writeNativeConfig, syncDevelopmentIssuer, exportAndroidArtifacts } from './mobile.mjs';

const key = (type, host) => `pk_${type}_${Buffer.from(`${host}$`).toString('base64')}`;
const dev = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: key('test', 'native-test.clerk.accounts.dev'),
  CONVEX_DEPLOYMENT: 'dev:gentle-fox-123',
  NEXT_PUBLIC_CONVEX_URL: 'https://gentle-fox-123.convex.cloud',
};
const prod = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: key('live', 'clerk.example.com'),
  CONVEX_DEPLOYMENT: 'prod:bright-owl-456',
  NEXT_PUBLIC_CONVEX_URL: 'https://bright-owl-456.convex.cloud',
};

test('unflagged builds are demo; local is explicit; E2E cannot use production', () => {
  assert.equal(parseOptions(['build']).mode, 'demo');
  assert.equal(parseOptions(['e2e', '--local']).mode, 'local');
  assert.throws(() => parseOptions(['e2e', '--release']), /release.*build/i);
  assert.throws(() => parseOptions(['build', '--local', '--release']), /one environment/i);
  assert.throws(() => parseOptions(['build', '--typo']), /unknown/i);
  assert.throws(() => parseOptions(['setup', '--release']), /release.*build/i);
  assert.throws(() => parseOptions(['build', '--platform', 'other']), /platform/i);
});

test('local resolves a matched development pair and derives the issuer', () => {
  const config = resolveConfig('local', dev);
  assert.equal(config.issuer, 'https://native-test.clerk.accounts.dev');
  assert.equal(config.deployment, 'dev:gentle-fox-123');
  assert.equal(resolveConfig('release', prod).deployment, 'prod:bright-owl-456');
});

test('cross-environment credentials and deployment URL mismatches fail closed', () => {
  for (const [mode, input] of [
    ['local', prod], ['release', dev],
    ['local', { ...dev, CONVEX_DEPLOYMENT: prod.CONVEX_DEPLOYMENT }],
    ['local', { ...dev, NEXT_PUBLIC_CONVEX_URL: prod.NEXT_PUBLIC_CONVEX_URL }],
    ['local', { ...dev, CLERK_JWT_ISSUER_DOMAIN: 'https://clerk.example.com' }],
    ['local', { ...dev, CONVEX_DEPLOY_KEY: 'prod:bright-owl-456|sensitive' }],
    ['local', { ...dev, CONVEX_DEPLOY_KEY: 'dev:other-999|sensitive' }],
    ['local', { ...dev, CONVEX_DEPLOY_KEY: 'dev:gentle-fox-123|sensitive\nCONVEX_SELF_HOSTED_URL=https://elsewhere.invalid' }],
    ['local', { ...dev, CONVEX_SELF_HOSTED_URL: 'http://localhost:3210' }],
    ['local', { ...dev, NEXT_PUBLIC_CONVEX_URL: 'https://user:pass@gentle-fox-123.convex.cloud' }],
    ['local', { ...dev, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_REPLACE_ME' }],
    ['release', {}],
  ]) assert.throws(() => resolveConfig(mode, input));
});

test('demo ignores all service credentials', () => {
  const config = resolveConfig('demo', { ...prod, CLERK_SECRET_KEY: 'sensitive' });
  assert.equal(config.publishableKey, '');
  assert.equal(config.convexURL, '');
});

test('native children do not inherit credentials or deployment overrides', () => {
  const env = cleanEnvironment({
    PATH: '/usr/bin', JAVA_HOME: '/jdk', CLERK_SECRET_KEY: 'sensitive',
    CONVEX_DEPLOY_KEY: 'sensitive', CONVEX_SELF_HOSTED_ADMIN_KEY: 'sensitive',
    NEXT_PUBLIC_CONVEX_URL: 'production', ORG_GRADLE_PROJECT_CODEX_TRACKER_CONVEX_URL: 'production',
    CODEX_TRACKER_CLERK_PUBLISHABLE_KEY: 'production',
  });
  assert.deepEqual(env, { PATH: '/usr/bin', JAVA_HOME: '/jdk' });
});

test('E2E builds use Debug; production is available only on release build path', () => {
  const local = buildCommands(parseOptions(['e2e', '--local']), '/repo', '/output', '/native.xcconfig');
  assert(local.some(c => c.args.includes('test')));
  assert(local.some(c => c.args.includes('connectedDebugAndroidTest')));
  assert(local.every(c => !c.args.includes('Release') && !c.args.includes('deploy')));
  const release = buildCommands(parseOptions(['build', '--release']), '/repo', '/output', '/native.xcconfig');
  assert(release.some(c => c.args.includes('Release')));
  assert(release.some(c => c.args.includes('bundleRelease')));
  assert(release.every(c => !c.args.includes('deploy')));
});

test('iOS builds preserve SDK-specific project signing; releases explicitly disable it', () => {
  for (const mode of ['local', 'demo']) {
    for (const action of ['build', 'e2e']) {
      const [ios] = buildCommands(parseOptions([action, `--${mode}`, '--platform', 'ios']), '/repo', '/output', '/native.xcconfig');
      assert(!ios.args.some(arg => arg.startsWith('CODE_SIGN')));
    }
  }
  const [release] = buildCommands(parseOptions(['build', '--release', '--platform', 'ios']), '/repo', '/output', '/native.xcconfig');
  assert(release.args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert(!release.args.includes('CODE_SIGN_IDENTITY=-'));
  assert(!release.args.some(arg => arg.includes('[sdk=iphonesimulator*]')));
  const [device] = buildCommands(parseOptions(['build', '--local', '--platform', 'ios', '--destination', 'generic/platform=iOS']), '/repo', '/output', '/native.xcconfig');
  assert(!device.args.some(arg => arg.startsWith('CODE_SIGN')));
});

test('generated native configuration contains only public settings and escapes xcconfig URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-config-'));
  try {
    const config = resolveConfig('local', { ...dev, CLERK_SECRET_KEY: 'never-copy-this' });
    const path = writeNativeConfig(config, dir);
    const text = readFileSync(path, 'utf8');
    assert(text.includes('https:/$()/gentle-fox-123.convex.cloud'));
    assert(text.includes('CLERK_FRONTEND_API_HOST = native-test.clerk.accounts.dev'));
    assert(!text.includes('never-copy-this'));
    writeFileSync(path, 'old production configuration');
    writeNativeConfig(resolveConfig('demo', prod), dir);
    assert(!readFileSync(path, 'utf8').includes('old production'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('setup refuses to replace a different existing issuer', async () => {
  const calls = [];
  await assert.rejects(syncDevelopmentIssuer('https://new.clerk.accounts.dev', async args => {
    calls.push(args);
    return 'https://existing.clerk.accounts.dev\n';
  }), /different Clerk issuer/);
  assert.deepEqual(calls, [['env', 'get', 'CLERK_JWT_ISSUER_DOMAIN']]);
});

test('failed deployment removes only a newly introduced issuer', async () => {
  for (const previous of ['', 'https://native-test.clerk.accounts.dev']) {
    const calls = [];
    await assert.rejects(syncDevelopmentIssuer('https://native-test.clerk.accounts.dev', async args => {
      calls.push(args);
      if (args[0] === 'dev') throw new Error('deployment failed');
      return previous;
    }), /deployment failed/);
    assert.equal(calls.some(args => args[1] === 'set'), previous === '');
    assert.equal(calls.some(args => args[1] === 'remove'), previous === '');
  }
});

test('setup reports failed rollback and never continues to native builds', async () => {
  await assert.rejects(syncDevelopmentIssuer('https://native-test.clerk.accounts.dev', async args => {
    if (args[0] === 'dev' || args[1] === 'remove') throw new Error('unavailable');
    return '';
  }), /could not be removed/);
});

test('iOS rejects direct Release and Debug production keys before compiling', () => {
  const script = new URL('../ios/Config/validate-environment.sh', import.meta.url);
  const env = { PATH: process.env.PATH, CLERK_PUBLISHABLE_KEY: prod.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    CONVEX_URL: prod.NEXT_PUBLIC_CONVEX_URL, CLERK_FRONTEND_API_HOST: 'clerk.example.com' };
  for (const configuration of ['Debug', 'Release']) {
    assert.notEqual(spawnSync('sh', [script.pathname], { env: { ...env, CONFIGURATION: configuration } }).status, 0);
  }
  assert.equal(spawnSync('sh', [script.pathname], { env: { ...env, CONFIGURATION: 'Release', CODEX_TRACKER_ENVIRONMENT: 'release' } }).status, 0);
});

test('Android exports preserve separate demo, local, and release artifacts', () => {
  const repo = mkdtempSync(join(tmpdir(), 'mobile-exports-'));
  try {
    for (const file of ['apk/debug/app-debug.apk', 'apk/androidTest/debug/app-debug-androidTest.apk',
      'apk/release/app-release-unsigned.apk', 'bundle/release/app-release.aab']) {
      const path = join(repo, 'apps/mobile/android/app/build/outputs', file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file);
    }
    for (const mode of ['demo', 'local', 'release']) exportAndroidArtifacts(mode, repo, join(repo, mode));
    assert.equal(readFileSync(join(repo, 'local/android/codex-tracker-debug.apk'), 'utf8'), 'apk/debug/app-debug.apk');
    assert.equal(readFileSync(join(repo, 'demo/android/codex-tracker-debug.apk'), 'utf8'), 'apk/debug/app-debug.apk');
    assert.equal(readFileSync(join(repo, 'release/android/codex-tracker-release-unsigned.aab'), 'utf8'), 'bundle/release/app-release.aab');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('CLI dry runs use the selected file despite ambient production credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mobile-cli-'));
  try {
    const envFile = join(dir, '.env.local');
    writeFileSync(envFile, Object.entries(dev).map(([k, v]) => `${k}=${v}`).join('\n'));
    const cli = new URL('./mobile.mjs', import.meta.url);
    const run = (...args) => spawnSync(process.execPath, ['--', cli.pathname, ...args], {
      encoding: 'utf8', env: { ...cleanEnvironment(process.env), ...prod, CONVEX_DEPLOY_KEY: 'production-secret-sentinel' },
    });
    const local = run('build', '--local', '--dry-run', '--env-file', envFile);
    assert.equal(local.status, 0, local.stderr);
    assert(local.stdout.includes('-configuration Debug'));
    assert(!local.stdout.includes('production-secret-sentinel'));
    assert(!local.stdout.includes(dev.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY));
    assert.notEqual(run('build', '--release', '--dry-run', '--env-file', envFile).status, 0);
    assert.notEqual(run('build', '--local', '--dry-run', '--env-file', join(dir, 'missing')).status, 0);
    assert.equal(run('build', '--demo', '--dry-run', '--env-file', join(dir, 'missing')).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

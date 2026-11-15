const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  parseArguments,
  validateManifest,
  strictEnvironment,
  copyCheckout,
} = require('./test-tenancy-candidate.js');

const tenancy = {
  name: '@nestarc/tenancy',
  version: '0.16.4',
  engines: { node: '^22.23.4 || ^24.22.1' },
};
const range = '^0.15.0 || ^0.16.0';

test('published defaults pin the verified trio and consumer Prisma version', () => {
  assert.deepEqual(parseArguments([]), {
    tenancyVersion: '0.16.4',
    auditLogVersion: '0.8.0',
    prismaVersion: '7.10.1',
  });
});

test('ambiguous or ranged dependency selectors are rejected', () => {
  for (const args of [
    ['--tenancy-version', '^0.16.4'],
    ['--audit-log-version', 'latest'],
    ['--tenancy-version', '0.16.4', '--tenancy-tarball', 'candidate.tgz'],
    ['--audit-log-version', '0.8.0', '--audit-log-version', '0.7.0'],
    ['--unknown', 'value'],
    ['--report'],
    ['--prisma-version', '5.22.0'],
  ])
    assert.throws(() => parseArguments(args));
});

test('tarball-only invocation keeps the caller-selected artifact and baseline audit', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'candidate-args-'));
  try {
    const file = path.join(directory, 'candidate.tgz');
    writeFileSync(file, 'test');
    const options = parseArguments(['--tenancy-tarball', file]);
    assert.equal(options.tenancyTarball, require('node:fs').realpathSync(file));
    assert.equal(options.tenancyVersion, undefined);
    assert.equal(options.auditLogVersion, undefined);
    assert.equal(
      parseArguments(['--tenancy-tarball', file, '--audit-log-version', '0.8.0']).auditLogVersion,
      '0.8.0',
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('actual Node support is evaluated as semver rather than comparing range strings', () => {
  assert.equal(validateManifest(tenancy, tenancy.name, range, 'v22.23.4'), tenancy);
  assert.equal(validateManifest(tenancy, tenancy.name, range, 'v24.22.1'), tenancy);
  assert.throws(() => validateManifest(tenancy, tenancy.name, range, 'v24.11.1'), /requires Node/);
  assert.throws(() => validateManifest(tenancy, tenancy.name, range, 'v22.13.0'), /requires Node/);
  const older = { ...tenancy, version: '0.15.0', engines: { node: '>=20' } };
  assert.equal(validateManifest(older, tenancy.name, range, 'v20.19.0'), older);
});

test('candidate validation rejects wrong identity, unsupported peers, and malformed engines', () => {
  assert.throws(
    () => validateManifest({ ...tenancy, version: '0.16.5-rc.1' }, tenancy.name, range),
    /outside/,
  );
  assert.throws(
    () => validateManifest({ ...tenancy, name: 'other' }, tenancy.name, range),
    /Expected/,
  );
  assert.throws(
    () => validateManifest({ ...tenancy, version: '0.17.0' }, tenancy.name, range),
    /outside/,
  );
  assert.throws(
    () => validateManifest({ ...tenancy, engines: { node: 'not-semver' } }, tenancy.name, range),
    /requires Node/,
  );
  assert.throws(
    () =>
      validateManifest(
        { name: '@nestarc/audit-log', version: '0.8.0' },
        '@nestarc/audit-log',
        '^0.7.0',
      ),
    /outside/,
  );
});

test('strict install settings override inherited npm bypass flags', () => {
  const env = strictEnvironment({
    NPM_CONFIG_FORCE: 'true',
    'npm_config_legacy-peer-deps': 'true',
    npm_config_registry: 'https://example.invalid/',
  });
  assert.equal(env.NPM_CONFIG_FORCE, undefined);
  assert.equal(env['npm_config_legacy-peer-deps'], undefined);
  assert.equal(env.npm_config_force, 'false');
  assert.equal(env.npm_config_legacy_peer_deps, 'false');
  assert.equal(env.npm_config_strict_peer_deps, 'true');
  assert.equal(env.npm_config_registry, 'https://registry.npmjs.org/');
});

test('scratch checkout includes new regression files and excludes ignored files and nested checkouts', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'candidate-copy-'));
  const source = path.join(directory, 'source');
  const destination = path.join(directory, 'copy');
  mkdirSync(source);
  mkdirSync(destination);
  try {
    execFileSync('git', ['init', '--quiet', source]);
    writeFileSync(path.join(source, '.gitignore'), 'ignored.txt\n');
    writeFileSync(path.join(source, 'tracked.txt'), 'tracked');
    execFileSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: source });
    writeFileSync(path.join(source, 'untracked.test.mjs'), 'new regression');
    writeFileSync(path.join(source, 'ignored.txt'), 'not a test input');
    const nested = path.join(source, '.tenancy-candidate');
    mkdirSync(nested);
    execFileSync('git', ['init', '--quiet', nested]);
    writeFileSync(path.join(nested, 'package.json'), '{}');
    copyCheckout(source, destination);
    assert.equal(readFileSync(path.join(destination, 'tracked.txt'), 'utf8'), 'tracked');
    assert.equal(
      readFileSync(path.join(destination, 'untracked.test.mjs'), 'utf8'),
      'new regression',
    );
    assert.throws(() => readFileSync(path.join(destination, 'ignored.txt')));
    assert.throws(() => readFileSync(path.join(destination, '.tenancy-candidate', 'package.json')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

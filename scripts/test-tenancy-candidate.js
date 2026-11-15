#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const semver = require('semver');

const TENANCY = '@nestarc/tenancy';
const AUDIT_LOG = '@nestarc/audit-log';
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const INSTALL_ARGS = [
  '--strict-peer-deps',
  '--no-force',
  '--no-legacy-peer-deps',
  `--registry=${PUBLIC_REGISTRY}`,
  '--replace-registry-host=never',
  '--no-audit',
  '--no-fund',
];
const USAGE =
  'Usage: npm run test:e2e:tenancy-candidate -- [--tenancy-version 0.16.4 | --tenancy-tarball /path/candidate.tgz] [--audit-log-version 0.8.0] [--prisma-version 7.10.1] [--report /path/report.json]';

function npmInvocation(args) {
  return process.env.npm_execpath
    ? { command: process.execPath, args: [process.env.npm_execpath, ...args] }
    : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args };
}

function runNpm(args, options = {}) {
  const invocation = npmInvocation(args);
  return execFileSync(invocation.command, invocation.args, {
    stdio: 'inherit',
    ...options,
  });
}

function strictEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  const options = [
    'force',
    'legacy_peer_deps',
    'registry',
    'replace_registry_host',
    'strict_peer_deps',
  ];
  for (const key of Object.keys(env)) {
    if (options.some((option) => key.toLowerCase().replaceAll('-', '_') === `npm_config_${option}`))
      delete env[key];
  }
  return {
    ...env,
    npm_config_force: 'false',
    npm_config_legacy_peer_deps: 'false',
    npm_config_registry: PUBLIC_REGISTRY,
    npm_config_replace_registry_host: 'never',
    npm_config_strict_peer_deps: 'true',
  };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function exactVersion(value, label) {
  if (!semver.valid(value) || value !== semver.valid(value))
    throw new Error(`${label} must be an exact semantic version, received ${value}`);
  return value;
}

function parseArguments(argv) {
  const options = {};
  const keys = new Map([
    ['--tenancy-version', 'tenancyVersion'],
    ['--tenancy-tarball', 'tenancyTarball'],
    ['--audit-log-version', 'auditLogVersion'],
    ['--prisma-version', 'prismaVersion'],
    ['--report', 'report'],
  ]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = keys.get(argv[i]);
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--') || options[key])
      throw new Error(USAGE);
    options[key] = argv[i + 1];
  }
  if (options.tenancyVersion && options.tenancyTarball)
    throw new Error('Choose --tenancy-version or --tenancy-tarball, not both');
  if (!options.tenancyTarball) options.tenancyVersion ??= '0.16.4';
  // Retain the original tarball-only command's baseline audit dependency.
  if (!options.tenancyTarball) options.auditLogVersion ??= '0.8.0';
  options.prismaVersion ??= '7.10.1';
  for (const key of ['tenancyVersion', 'auditLogVersion', 'prismaVersion']) {
    if (options[key]) exactVersion(options[key], key);
  }
  if (![6, 7].includes(semver.major(options.prismaVersion)))
    throw new Error('Packed consumer supports Prisma 6 or 7');
  if (options.tenancyTarball) {
    if (
      path.extname(options.tenancyTarball) !== '.tgz' ||
      !fs.statSync(options.tenancyTarball).isFile()
    )
      throw new Error('--tenancy-tarball must point to a regular .tgz file');
    options.tenancyTarball = fs.realpathSync(options.tenancyTarball);
  }
  if (options.report) options.report = path.resolve(options.report);
  return options;
}

function validateManifest(manifest, packageName, peerRange, nodeVersion = process.version) {
  if (manifest.name !== packageName)
    throw new Error(`Expected ${packageName}, received ${manifest.name}`);
  exactVersion(manifest.version, packageName);
  if (!peerRange || !semver.satisfies(manifest.version, peerRange)) {
    throw new Error(
      `${packageName}@${manifest.version} is outside soft-delete peer range ${peerRange}`,
    );
  }
  const engine = manifest.engines?.node;
  if (engine && (!semver.validRange(engine) || !semver.satisfies(nodeVersion, engine))) {
    throw new Error(
      `${packageName}@${manifest.version} requires Node ${engine}; running ${nodeVersion}`,
    );
  }
  return manifest;
}

function readPackedManifest(tarball) {
  return JSON.parse(
    execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
      encoding: 'utf8',
    }),
  );
}

function artifact(tarball, source, gitHead = null) {
  const manifest = readPackedManifest(tarball);
  return {
    tarball,
    manifest,
    evidence: {
      name: manifest.name,
      version: manifest.version,
      source,
      gitHead,
      node: manifest.engines?.node ?? null,
      integrity: `sha512-${createHash('sha512').update(fs.readFileSync(tarball)).digest('base64')}`,
    },
  };
}

function publishedArtifact(name, version, destination, env) {
  const spec = `${name}@${exactVersion(version, name)}`;
  const metadata = JSON.parse(
    runNpm(['view', spec, '--json', `--registry=${PUBLIC_REGISTRY}`], {
      cwd: destination,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  );
  const packed = JSON.parse(
    runNpm(
      [
        'pack',
        spec,
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        destination,
        `--registry=${PUBLIC_REGISTRY}`,
      ],
      {
        cwd: destination,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    ),
  );
  if (packed.length !== 1) throw new Error(`Expected one artifact for ${spec}`);
  const result = artifact(
    path.join(destination, packed[0].filename),
    metadata.dist.tarball,
    metadata.gitHead ?? null,
  );
  if (result.manifest.version !== version || result.evidence.integrity !== metadata.dist.integrity)
    throw new Error(`Registry artifact mismatch for ${spec}`);
  return result;
}

function copyCheckout(source, destination) {
  // New regression fixtures must be included before they have been committed.
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: source },
  );
  for (const relative of new Set(output.toString('utf8').split('\0').filter(Boolean))) {
    const input = path.join(source, relative);
    if (!fs.existsSync(input) || fs.statSync(input).isDirectory()) continue;
    const outputFile = path.join(destination, relative);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.copyFileSync(input, outputFile);
  }
}

function installCheckout(root, tenancy, audit, temporaryRoot, env) {
  const checkout = path.join(temporaryRoot, 'checkout');
  fs.mkdirSync(checkout);
  copyCheckout(root, checkout);
  const manifestPath = path.join(checkout, 'package.json');
  const manifest = readJson(manifestPath);
  manifest.devDependencies[TENANCY] = `file:${tenancy.tarball}`;
  manifest.devDependencies[AUDIT_LOG] = `file:${audit.tarball}`;
  writeJson(manifestPath, manifest);
  runNpm(['install', '--package-lock-only', '--ignore-scripts', ...INSTALL_ARGS], {
    cwd: checkout,
    env,
  });
  runNpm(['ci', ...INSTALL_ARGS], { cwd: checkout, env });
  for (const selected of [tenancy, audit]) {
    const installed = readJson(
      path.join(checkout, 'node_modules', selected.manifest.name, 'package.json'),
    );
    if (installed.version !== selected.manifest.version)
      throw new Error(`Installed ${selected.manifest.name} version mismatch`);
  }
  runNpm(['run', 'test:types'], { cwd: checkout, env });
  runNpm(['run', 'test:e2e:cross-package'], { cwd: checkout, env });
  return checkout;
}

function packSoftDelete(checkout, destination, env) {
  const packed = JSON.parse(
    runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', destination], {
      cwd: checkout,
      env,
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    }),
  );
  if (packed.length !== 1) throw new Error('Expected one soft-delete artifact');
  return artifact(path.join(destination, packed[0].filename), 'local checkout build');
}

function verifyPackedConsumer(
  checkout,
  softDelete,
  tenancy,
  audit,
  temporaryRoot,
  env,
  options,
  modern,
) {
  const consumer = path.join(temporaryRoot, 'consumer');
  fs.mkdirSync(consumer);
  const dependencies = {
    '@nestarc/soft-delete': `file:${softDelete.tarball}`,
    [TENANCY]: `file:${tenancy.tarball}`,
    [AUDIT_LOG]: `file:${audit.tarball}`,
    '@nestjs/common': '11.2.1',
    '@nestjs/core': '11.2.1',
    '@prisma/client': options.prismaVersion,
    'reflect-metadata': '0.2.2',
    rxjs: '7.8.2',
  };
  if (modern)
    Object.assign(dependencies, {
      prisma: options.prismaVersion,
      '@prisma/adapter-pg': options.prismaVersion,
      pg: '8.22.0',
    });
  writeJson(path.join(consumer, 'package.json'), {
    name: 'soft-delete-audit-lifecycle-consumer',
    version: '0.0.0',
    private: true,
    dependencies,
  });
  runNpm(['install', '--ignore-scripts', ...INSTALL_ARGS], {
    cwd: consumer,
    env,
  });
  for (const selected of [softDelete, tenancy, audit]) {
    const installed = readJson(
      path.join(consumer, 'node_modules', selected.manifest.name, 'package.json'),
    );
    if (installed.version !== selected.manifest.version)
      throw new Error(
        `Consumer installed unexpected ${selected.manifest.name}@${installed.version}`,
      );
  }
  execFileSync(
    process.execPath,
    [
      '-e',
      "const sd=require('@nestarc/soft-delete');const ten=require('@nestarc/tenancy');if(typeof sd.createPrismaSoftDeleteExtension!=='function'||typeof ten.createPrismaTenancyExtension!=='function')process.exit(1);const c=new ten.TenancyContext();if(c.run('candidate',()=>c.getTenantId())!=='candidate')process.exit(1)",
    ],
    { cwd: consumer, env, stdio: 'inherit' },
  );
  if (modern) {
    for (const file of ['schema.prisma', 'verify.mjs'])
      fs.copyFileSync(
        path.join(checkout, 'test', 'consumer-audit-lifecycle', file),
        path.join(consumer, file),
      );
    if (semver.major(options.prismaVersion) === 6) {
      const schema = path.join(consumer, 'schema.prisma');
      fs.writeFileSync(
        schema,
        fs
          .readFileSync(schema, 'utf8')
          .replace(
            'provider = "postgresql"',
            'provider = "postgresql"\n  url = env("DATABASE_URL")',
          ),
      );
    } else {
      fs.writeFileSync(
        path.join(consumer, 'prisma.config.ts'),
        "import { defineConfig } from 'prisma/config';\nexport default defineConfig({ schema: 'schema.prisma', datasource: { url: process.env.DATABASE_URL } });\n",
      );
    }
    execFileSync(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'generate', '--schema=schema.prisma'],
      { cwd: consumer, env, stdio: 'inherit' },
    );
    execFileSync(process.execPath, ['verify.mjs'], {
      cwd: consumer,
      env,
      stdio: 'inherit',
    });
  }
  const lock = readJson(path.join(consumer, 'package-lock.json'));
  return {
    prisma: options.prismaVersion,
    mode: modern ? 'callback-rls-postgresql' : 'legacy-import',
    packages: Object.fromEntries(
      Object.keys(dependencies)
        .map((name) => [name, lock.packages[`node_modules/${name}`]])
        .map(([name, entry]) => [
          name,
          {
            version: entry.version,
            resolved: entry.resolved,
            integrity: entry.integrity,
          },
        ]),
    ),
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const manifest = readJson(path.join(root, 'package.json'));
  options.auditLogVersion ??= manifest.devDependencies[AUDIT_LOG];
  const modern = semver.gte(options.auditLogVersion, '0.8.0');
  const env = strictEnvironment({
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:5432/soft_delete_test',
    SOFT_DELETE_TENANCY_MODE: modern ? 'callback' : 'auto',
  });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-delete-tenancy-candidate-'));
  const report = {
    status: 'failed',
    node: process.version,
    softDeleteCheckoutHead: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    softDeleteWorkingTreeChanged:
      execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
        .length > 0,
    artifacts: [],
  };
  try {
    const tenancy = options.tenancyTarball
      ? artifact(
          options.tenancyTarball,
          options.tenancyTarball,
          process.env.TENANCY_CANDIDATE_SHA ?? null,
        )
      : publishedArtifact(TENANCY, options.tenancyVersion, temporaryRoot, env);
    validateManifest(tenancy.manifest, TENANCY, manifest.peerDependencies[TENANCY]);
    const audit = publishedArtifact(AUDIT_LOG, options.auditLogVersion, temporaryRoot, env);
    validateManifest(audit.manifest, AUDIT_LOG, manifest.peerDependencies[AUDIT_LOG]);
    report.artifacts.push(tenancy.evidence, audit.evidence);
    const checkout = installCheckout(root, tenancy, audit, temporaryRoot, env);
    const softDelete = packSoftDelete(checkout, temporaryRoot, env);
    report.artifacts.push(softDelete.evidence);
    report.consumer = verifyPackedConsumer(
      checkout,
      softDelete,
      tenancy,
      audit,
      temporaryRoot,
      env,
      options,
      modern,
    );
    report.status = 'passed';
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    console.log(JSON.stringify(report, null, 2));
    if (options.report) {
      fs.mkdirSync(path.dirname(options.report), { recursive: true });
      writeJson(options.report, report);
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

module.exports = {
  parseArguments,
  validateManifest,
  strictEnvironment,
  copyCheckout,
};
if (require.main === module) main();

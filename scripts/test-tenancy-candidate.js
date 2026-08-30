#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGE_NAME = '@nestarc/tenancy';
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

function npmInvocation(args) {
  const npmExecPath = process.env.npm_execpath;
  return npmExecPath
    ? { command: process.execPath, args: [npmExecPath, ...args] }
    : { command: 'npm', args };
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
  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase().replaceAll('-', '_');
    if (
      normalized === 'npm_config_force' ||
      normalized === 'npm_config_legacy_peer_deps' ||
      normalized === 'npm_config_registry' ||
      normalized === 'npm_config_replace_registry_host' ||
      normalized === 'npm_config_strict_peer_deps'
    ) {
      delete env[key];
    }
  }
  env.npm_config_force = 'false';
  env.npm_config_legacy_peer_deps = 'false';
  env.npm_config_registry = PUBLIC_REGISTRY;
  env.npm_config_replace_registry_host = 'never';
  env.npm_config_strict_peer_deps = 'true';
  return env;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--tenancy-tarball' || !argv[1]) {
    throw new Error(
      'Usage: npm run test:e2e:tenancy-candidate -- --tenancy-tarball /absolute/path/to/candidate.tgz',
    );
  }
  const tarball = path.resolve(argv[1]);
  if (path.extname(tarball) !== '.tgz') {
    throw new Error('--tenancy-tarball must point to a .tgz file');
  }
  const stat = fs.statSync(tarball);
  if (!stat.isFile()) {
    throw new Error('The tenancy candidate must be a regular file');
  }
  return fs.realpathSync(tarball);
}

function readPackedManifest(tarball) {
  const raw = execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
    encoding: 'utf8',
  });
  return JSON.parse(raw);
}

function validateCandidate(tarball) {
  const manifest = readPackedManifest(tarball);
  if (manifest.name !== PACKAGE_NAME) {
    throw new Error(`Expected ${PACKAGE_NAME}, received ${String(manifest.name)}`);
  }
  if (!/^0\.16\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error(`Expected a 0.16.x tenancy candidate, received ${manifest.version}`);
  }
  if (manifest.engines?.node !== '^22.13.0 || ^24.0.0') {
    throw new Error(
      `Unexpected tenancy Node contract: ${String(manifest.engines?.node)}`,
    );
  }
  return manifest;
}

function copyTrackedCheckout(source, destination) {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: source });
  for (const relativePath of output.toString('utf8').split('\0').filter(Boolean)) {
    const sourcePath = path.join(source, relativePath);
    const destinationPath = path.join(destination, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function installCandidateCheckout(root, tarball, temporaryRoot, env) {
  const checkout = path.join(temporaryRoot, 'checkout');
  fs.mkdirSync(checkout);
  copyTrackedCheckout(root, checkout);

  const manifestPath = path.join(checkout, 'package.json');
  const manifest = readJson(manifestPath);
  manifest.devDependencies[PACKAGE_NAME] = `file:${tarball}`;
  writeJson(manifestPath, manifest);

  runNpm(['install', '--package-lock-only', '--ignore-scripts', ...INSTALL_ARGS], {
    cwd: checkout,
    env,
  });
  runNpm(['ci', ...INSTALL_ARGS], { cwd: checkout, env });

  const installed = readJson(
    path.join(checkout, 'node_modules', '@nestarc', 'tenancy', 'package.json'),
  );
  if (installed.version !== validateCandidate(tarball).version) {
    throw new Error(`Installed tenancy version mismatch: ${installed.version}`);
  }

  runNpm(['run', 'test:types'], { cwd: checkout, env });
  runNpm(['run', 'test:e2e:cross-package'], { cwd: checkout, env });
  return checkout;
}

function packSoftDelete(checkout, temporaryRoot, env) {
  const output = runNpm(
    ['pack', '--json', '--pack-destination', temporaryRoot],
    { cwd: checkout, env, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  );
  const result = JSON.parse(output);
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error('Expected npm pack to produce one soft-delete artifact');
  }
  return path.join(temporaryRoot, result[0].filename);
}

function verifyPackedConsumer(softDeleteTarball, tenancyTarball, temporaryRoot, env) {
  const consumer = path.join(temporaryRoot, 'consumer');
  fs.mkdirSync(consumer);
  writeJson(path.join(consumer, 'package.json'), {
    name: 'soft-delete-tenancy-candidate-consumer',
    version: '0.0.0',
    private: true,
    dependencies: {
      '@nestarc/soft-delete': `file:${softDeleteTarball}`,
      [PACKAGE_NAME]: `file:${tenancyTarball}`,
      '@nestjs/common': '11.2.1',
      '@nestjs/core': '11.2.1',
      '@prisma/client': '7.10.0',
      'reflect-metadata': '0.2.2',
      rxjs: '7.8.2',
    },
  });

  runNpm(['install', '--ignore-scripts', ...INSTALL_ARGS], { cwd: consumer, env });
  const installedSoftDelete = readJson(
    path.join(consumer, 'node_modules', '@nestarc', 'soft-delete', 'package.json'),
  );
  const installedTenancy = readJson(
    path.join(consumer, 'node_modules', '@nestarc', 'tenancy', 'package.json'),
  );
  if (installedSoftDelete.peerDependencies[PACKAGE_NAME] !== '^0.15.0 || ^0.16.0') {
    throw new Error('Packed soft-delete artifact has an unexpected tenancy peer range');
  }
  if (!installedTenancy.version.startsWith('0.16.')) {
    throw new Error(`Packed consumer installed tenancy ${installedTenancy.version}`);
  }

  execFileSync(
    process.execPath,
    [
      '-e',
      "const sd=require('@nestarc/soft-delete');const ten=require('@nestarc/tenancy');if(typeof sd.createPrismaSoftDeleteExtension!=='function'||typeof ten.createPrismaTenancyExtension!=='function')process.exit(1);const context=new ten.TenancyContext();if(context.run('candidate-tenant',()=>context.getTenantId())!=='candidate-tenant')process.exit(1)",
    ],
    { cwd: consumer, env, stdio: 'inherit' },
  );

  console.log(
    JSON.stringify(
      {
        softDelete: {
          version: installedSoftDelete.version,
          source: fs.realpathSync(
            path.join(consumer, 'node_modules', '@nestarc', 'soft-delete'),
          ),
        },
        tenancy: {
          version: installedTenancy.version,
          source: fs.realpathSync(
            path.join(consumer, 'node_modules', '@nestarc', 'tenancy'),
          ),
        },
      },
      null,
      2,
    ),
  );
}

function main() {
  const tenancyTarball = parseArguments(process.argv.slice(2));
  const candidate = validateCandidate(tenancyTarball);
  const root = path.resolve(__dirname, '..');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-delete-tenancy-candidate-'));
  const env = strictEnvironment({
    DATABASE_URL:
      process.env.DATABASE_URL ??
      'postgresql://test:test@127.0.0.1:5432/soft_delete_test',
  });

  console.log(
    `Testing ${PACKAGE_NAME}@${candidate.version} from ${tenancyTarball} on Node ${process.version}`,
  );
  try {
    const checkout = installCandidateCheckout(
      root,
      tenancyTarball,
      temporaryRoot,
      env,
    );
    const softDeleteTarball = packSoftDelete(checkout, temporaryRoot, env);
    verifyPackedConsumer(softDeleteTarball, tenancyTarball, temporaryRoot, env);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();

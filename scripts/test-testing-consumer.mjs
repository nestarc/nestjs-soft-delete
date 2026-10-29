import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = mkdtempSync(path.join(os.tmpdir(), 'soft-delete-testing-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd = workspace) => execFileSync(command, args, {
  cwd,
  stdio: 'inherit',
  env: process.env,
});

try {
  let tarball = process.env.SOFT_DELETE_TARBALL;
  if (tarball) {
    tarball = path.resolve(tarball);
  } else {
    const packed = JSON.parse(execFileSync(npm, [
      'pack', '--json', '--ignore-scripts', '--pack-destination', workspace,
    ], { cwd: root, encoding: 'utf8' }));
    assert.equal(packed.length, 1);
    tarball = path.join(workspace, packed[0].filename);
  }

  const dependencies = { '@nestarc/soft-delete': `file:${tarball}` };
  for (const name of [
    '@nestjs/common', '@nestjs/core', '@nestjs/testing', '@prisma/client',
    'reflect-metadata', 'rxjs', 'typescript', '@types/node',
  ]) {
    dependencies[name] = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  }
  writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'soft-delete-testing-consumer', private: true, dependencies,
  }, null, 2));
  cpSync(path.join(root, 'test/consumer-testing'), workspace, { recursive: true });
  run(npm, ['install', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund']);
  run(process.execPath, ['consumer.cjs']);
  run(process.execPath, ['consumer.mjs']);
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
  console.log('Packed /testing consumer passed: CommonJS, ESM, shared context, DI, cascade restore, and public types.');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

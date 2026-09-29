/// <reference types="node" />
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { CliUsageError } from '../args';
import { CliInputError, extensionOf, findPackageRoot, nodeIo, ownGitInfo, parseJsonFile, resolveConfig, takeRepeated, type CliIo } from './common';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WORK = mkdtempSync(join(tmpdir(), 'fusion-common-'));
afterAll(() => rmSync(WORK, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

describe('nodeIo', () => {
  it('reads and writes files, and writes to the process streams', () => {
    const io = nodeIo();
    const f = join(WORK, 'a.txt');
    io.writeFile(f, 'héllo');
    expect(io.readText(f)).toBe('héllo');
    io.writeFile(f, Uint8Array.of(0x41, 0x42));
    expect(readFileSync(f, 'utf8')).toBe('AB');
    expect(() => io.readText(join(WORK, 'nope.txt'))).toThrow(/ENOENT/);
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    io.stdout.write('to stdout');
    io.stderr.write('to stderr');
    expect(out).toHaveBeenCalledWith('to stdout');
    expect(err).toHaveBeenCalledWith('to stderr');
    expect(typeof io.stdout.isTTY).toBe('boolean');
    expect(typeof io.stderr.isTTY).toBe('boolean');
  });
});

describe('a reader that closes the pipe early', () => {
  it('an EPIPE on stdout is ignored, any other stream error is not', () => {
    nodeIo();
    const before = process.stdout.listenerCount('error');
    expect(() => process.stdout.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).not.toThrow();
    expect(() => process.stdout.emit('error', new Error('disk full'))).toThrow('disk full');
    nodeIo();
    expect(process.stdout.listenerCount('error')).toBe(before); // the guard is installed once
  });
});

describe('findPackageRoot', () => {
  const pkg = (dir: string, name: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'package.json'), JSON.stringify({ name })); };
  it('finds this repository from a file inside it', () => {
    expect(findPackageRoot(import.meta.url)).toBe(resolve(ROOT).replace(/[\\/]$/, ''));
  });
  it('walks up past the package.json of another package', () => {
    pkg(join(WORK, 'a'), 'fusion-reactor-simulator');
    pkg(join(WORK, 'a', 'node_modules', 'other'), 'other');
    mkdirSync(join(WORK, 'a', 'node_modules', 'other', 'lib'), { recursive: true });
    expect(findPackageRoot(pathToFileURL(join(WORK, 'a', 'node_modules', 'other', 'lib', 'x.js')).href)).toBe(join(WORK, 'a'));
  });
  it('gives up at the top of the file system', () => {
    expect(findPackageRoot(pathToFileURL(join(parse(process.cwd()).root, 'x.js')).href)).toBeUndefined();
  });
  it('skips an unreadable package.json and never returns a directory below the start', () => {
    mkdirSync(join(WORK, 'b', 'c'), { recursive: true });
    writeFileSync(join(WORK, 'b', 'package.json'), '{ not json');
    const r = findPackageRoot(pathToFileURL(join(WORK, 'b', 'c', 'x.js')).href);
    expect(r === undefined || !r.startsWith(WORK)).toBe(true);
  });
});

describe('helpers', () => {
  it('extensionOf', () => {
    expect(extensionOf(undefined)).toBe('');
    expect(extensionOf('a/b.NC')).toBe('nc');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('a.b.csv')).toBe('csv');
  });
  it('parseJsonFile names the file on a read or a parse error and drops a BOM', () => {
    const io: CliIo = {
      stdout: { write() {}, isTTY: false }, stderr: { write() {}, isTTY: false },
      readText: (p) => { if (p === 'bom') return '﻿{"a":1}'; if (p === 'bad') return '{'; throw Object.assign(new Error('x'), { code: 'EACCES' }); },
      writeFile() {},
    };
    expect(parseJsonFile(io, 'bom')).toEqual({ a: 1 });
    expect(() => parseJsonFile(io, 'bad')).toThrow(/^bad: not valid JSON/);
    expect(() => parseJsonFile(io, 'other')).toThrow(/cannot read other: EACCES/);
    expect(() => parseJsonFile(io, 'other')).toThrow(CliInputError);
  });
  it('resolveConfig without a preset or a file is an input error', () => {
    const io = {} as CliIo;
    expect(() => resolveConfig({ preset: undefined, config: undefined, 't-end': undefined, seed: undefined, fidelity: undefined, fuel: undefined, 'no-validate': false }, [], io)).toThrow(CliInputError);
  });
  it('takeRepeated leaves other flags alone and reports a dangling flag as a usage error', () => {
    expect(takeRepeated(['--a', '1'], ['set'])).toEqual({ rest: ['--a', '1'], values: { set: [] } });
    expect(() => takeRepeated(['--param'], ['param'])).toThrow(CliUsageError);
  });
});

describe('ownGitInfo', () => {
  const git = (cwd: string, ...a: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  const hasGit = spawnSync('git', ['--version']).status === 0;
  it.skipIf(!hasGit)('reports the commit of the package own repository, never that of a repository the package sits inside', () => {
    // a consumer project (a git repository) with the package installed under node_modules (not a repository of its own)
    const consumer = join(WORK, 'consumer');
    const pkg = join(consumer, 'node_modules', 'fusion-reactor-simulator');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), '{"name":"fusion-reactor-simulator","version":"1.2.3"}');
    expect(git(consumer, 'init', '-q').status).toBe(0);
    git(consumer, 'add', '-A', '-f');
    expect(git(consumer, 'commit', '-q', '-m', 'consumer').status).toBe(0);
    const consumerSha = git(consumer, 'rev-parse', 'HEAD').stdout.trim();
    expect(consumerSha).toMatch(/^[0-9a-f]{40}$/);
    expect(ownGitInfo(pkg)).toBeNull();
    expect(ownGitInfo(consumer)).toEqual({ sha: consumerSha, dirty: false });
    // a package that is its own repository does report its commit
    const own = join(WORK, 'own');
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, 'a.txt'), 'x');
    git(own, 'init', '-q');
    git(own, 'add', '-A');
    git(own, 'commit', '-q', '-m', 'own');
    expect(ownGitInfo(own)?.sha).toBe(git(own, 'rev-parse', 'HEAD').stdout.trim());
  });
});

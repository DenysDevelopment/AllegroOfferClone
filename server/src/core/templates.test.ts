import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TemplateStore } from './templates.js';

let dir: string;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tpl-'));
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

const sampleSections = [
  { items: [{ type: 'TEXT' as const, content: 'SSD {{SSD}}' }] },
];

describe('TemplateStore', () => {
  it('returns an empty list when the file does not exist', async () => {
    const store = new TemplateStore(path.join(dir, 'templates.json'));
    expect(await store.list()).toEqual([]);
  });

  it('creates a template with an id and timestamps', async () => {
    const store = new TemplateStore(path.join(dir, 'templates.json'));
    const t = await store.create('Laptop base', sampleSections);
    expect(t.id).toMatch(/.+/);
    expect(t.name).toBe('Laptop base');
    expect(t.sections).toEqual(sampleSections);
    expect(t.createdAt).toBeGreaterThan(0);
    expect(t.updatedAt).toBe(t.createdAt);
  });

  it('persists created templates across store instances', async () => {
    const file = path.join(dir, 'templates.json');
    await new TemplateStore(file).create('Laptop base', sampleSections);
    const list = await new TemplateStore(file).list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Laptop base');
  });

  it('updates name and sections, bumps updatedAt', async () => {
    const file = path.join(dir, 'templates.json');
    const store = new TemplateStore(file);
    const t = await store.create('Old', sampleSections);
    const updated = await store.update(t.id, { name: 'New' });
    expect(updated?.name).toBe('New');
    expect(updated?.createdAt).toBe(t.createdAt);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(t.createdAt);
  });

  it('returns null when updating a missing id', async () => {
    const store = new TemplateStore(path.join(dir, 'templates.json'));
    expect(await store.update('nope', { name: 'x' })).toBeNull();
  });

  it('removes a template and reports whether it existed', async () => {
    const file = path.join(dir, 'templates.json');
    const store = new TemplateStore(file);
    const t = await store.create('Doomed', sampleSections);
    expect(await store.remove(t.id)).toBe(true);
    expect(await store.remove(t.id)).toBe(false);
    expect(await store.list()).toEqual([]);
  });

  it('writes atomically (no leftover .tmp file)', async () => {
    const file = path.join(dir, 'templates.json');
    await new TemplateStore(file).create('A', sampleSections);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface DescriptionTemplateItem {
  type: 'TEXT' | 'IMAGE';
  content?: string;
  url?: string;
}

export interface DescriptionTemplateSection {
  items: DescriptionTemplateItem[];
}

export interface DescriptionTemplate {
  id: string;
  name: string;
  sections: DescriptionTemplateSection[];
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
}

/**
 * File-backed store for description templates. Global (not per-account):
 * a single JSON array persisted with an atomic tmp+rename write, mirroring
 * TokenStore's persistence approach.
 */
export class TemplateStore {
  constructor(private readonly file: string) {}

  async list(): Promise<DescriptionTemplate[]> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DescriptionTemplate[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async create(
    name: string,
    sections: DescriptionTemplateSection[],
  ): Promise<DescriptionTemplate> {
    const now = Date.now();
    const template: DescriptionTemplate = {
      id: randomUUID(),
      name,
      sections,
      createdAt: now,
      updatedAt: now,
    };
    const all = await this.list();
    all.push(template);
    await this.writeAll(all);
    return template;
  }

  async update(
    id: string,
    patch: { name?: string; sections?: DescriptionTemplateSection[] },
  ): Promise<DescriptionTemplate | null> {
    const all = await this.list();
    const idx = all.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const next: DescriptionTemplate = {
      ...all[idx],
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.sections !== undefined ? { sections: patch.sections } : {}),
      updatedAt: Date.now(),
    };
    all[idx] = next;
    await this.writeAll(all);
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const all = await this.list();
    const next = all.filter((t) => t.id !== id);
    if (next.length === all.length) return false;
    await this.writeAll(next);
    return true;
  }

  private async writeAll(all: DescriptionTemplate[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }
}

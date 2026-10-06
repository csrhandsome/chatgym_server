import type { Message } from 'mem0ai/oss';
import { MemoryNotFoundError, type Mem0Adapter, type MemoryQuery, type MemoryScope, type StoredMemory } from '../../src/agent/shared/mem0-adapter';

/** Explicit test-only injection. Never imported by application code. */
export class FakeMem0Adapter implements Mem0Adapter {
  readonly records = new Map<string, StoredMemory & { scope: MemoryScope }>();
  readonly calls: Array<{ operation: string; userId: string; options?: unknown }> = [];
  private matches(userId: string, options: MemoryQuery = {}) {
    return [...this.records.values()].filter(item => item.userId === userId && (!options.scope || item.scope === options.scope)
      && Object.entries(options.metadata || {}).every(([key, value]) => item.metadata[key] === value));
  }
  async add(userId: string, messages: Message[], options: { scope: MemoryScope; infer: boolean; metadata: Record<string, unknown> }) {
    this.calls.push({ operation: 'add', userId, options: structuredClone(options) });
    const result = messages.map(message => {
      const item = { id: crypto.randomUUID(), userId, memory: String(message.content), scope: options.scope,
        metadata: structuredClone(options.metadata), createdAt: new Date().toISOString() };
      this.records.set(item.id, item);
      return structuredClone(item);
    });
    return result;
  }
  async list(userId: string, options: MemoryQuery = {}) {
    this.calls.push({ operation: 'list', userId, options });
    return this.matches(userId, options).slice(0, options.limit || 10_001).map(item => structuredClone(item));
  }
  async search(userId: string, query: string, options: MemoryQuery = {}) {
    this.calls.push({ operation: 'search', userId, options: { ...options, query } });
    const terms = query.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean);
    return this.matches(userId, options).map(item => ({ ...structuredClone(item), score: terms.filter(term => item.memory.toLowerCase().includes(term)).length / Math.max(1, terms.length) }))
      .sort((a, b) => b.score - a.score).slice(0, options.limit || 5);
  }
  async get(userId: string, id: string): Promise<StoredMemory> {
    const item = this.records.get(id);
    if (!item || item.userId !== userId) throw new MemoryNotFoundError();
    return structuredClone(item);
  }
  async update(userId: string, id: string, text: string, metadata: Record<string, unknown> = {}) {
    await this.get(userId, id);
    const item = this.records.get(id)!;
    item.memory = text; item.metadata = { ...item.metadata, ...structuredClone(metadata) }; item.updatedAt = new Date().toISOString();
    return structuredClone(item);
  }
  async delete(userId: string, id: string) { await this.get(userId, id); this.records.delete(id); }
}

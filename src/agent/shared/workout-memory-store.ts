import { createHash } from 'node:crypto';
import { Mem0OssAdapter, MemoryNotFoundError, MemoryUnavailableError, type Mem0Adapter, type StoredMemory } from './mem0-adapter';
import { workoutMemoryInputSchema, type RetrievedMemory, type WorkoutMemoryInput } from './types';

export { MemoryNotFoundError, MemoryUnavailableError } from './mem0-adapter';
export type { StoredMemory } from './mem0-adapter';
export type RecentWorkoutMemory = Omit<RetrievedMemory, 'score' | 'daysAgo' | 'matchedTerms'>;
export interface WorkoutMemorySummary {
  readonly totalStoredSessions: number;
  readonly uniqueUsers: number;
  readonly latestSessionAt: string | null;
}

export const workoutFingerprint = (userId: string, session: WorkoutMemoryInput) => createHash('sha256').update(JSON.stringify({
  userId, sourceId: session.sourceId ?? null, completedAt: session.completedAt,
  sessionType: session.sessionType, durationMinutes: session.durationMinutes,
  exerciseNames: [...session.exerciseNames].sort(),
})).digest('hex');

export class WorkoutMemoryStore {
  private readonly writes = new Map<string, Promise<unknown>>();
  // Health reports locally observed sessions only; this cache never serves reads.
  private readonly observed = new Map<string, { userId: string; completedAt: string }>();
  constructor(private readonly adapter: Mem0Adapter = new Mem0OssAdapter()) {
    if (typeof adapter === 'string') throw new Error('SQLite memory is retired. Inject a Mem0Adapter for tests; use scripts/migrate-workout-memory.ts for legacy databases.');
  }

  private async serial<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(userId) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.writes.set(userId, next);
    try { return await next; }
    finally { if (this.writes.get(userId) === next) this.writes.delete(userId); }
  }

  private observe(items: StoredMemory[]) {
    for (const item of items) {
      if (item.metadata.kind === 'workout_session') {
        const session = workoutMemoryInputSchema.parse(item.metadata.session);
        this.observed.set(item.id, { userId: item.userId, completedAt: session.completedAt });
      }
    }
  }

  private session(item: StoredMemory): RecentWorkoutMemory {
    const input = workoutMemoryInputSchema.parse(item.metadata.session);
    return { id: item.id, completedAt: input.completedAt, sessionType: input.sessionType,
      durationMinutes: input.durationMinutes, exerciseNames: input.exerciseNames, muscleGroups: input.muscleGroups,
      intensity: input.intensity, goalTag: input.goalTag ?? null, notes: input.notes ?? null };
  }

  async storeSession(userId: string, input: WorkoutMemoryInput, provenance: Record<string, unknown> = {}): Promise<string> {
    const session = workoutMemoryInputSchema.parse(input);
    const fingerprint = workoutFingerprint(userId, session);
    return this.serial(userId, async () => {
      const existing = await this.adapter.list(userId, { scope: 'workout', metadata: { fingerprint }, limit: 1 });
      if (existing[0]) { this.observe(existing); return existing[0].id; }
      const text = `Completed workout at ${session.completedAt}: ${session.sessionType}; ${session.durationMinutes} minutes; exercises: ${session.exerciseNames.join(', ')}; muscle groups: ${session.muscleGroups.join(', ')}; intensity: ${session.intensity}; goal: ${session.goalTag || ''}; notes: ${session.notes || ''}`;
      const items = await this.adapter.add(userId, [{ role: 'user', content: text }], {
        scope: 'workout', infer: false,
        metadata: { schemaVersion: 1, kind: 'workout_session', fingerprint, session,
          source: 'workout_session', sourceId: session.sourceId || fingerprint,
          sourceInput: structuredClone(session), provenance, recordedAt: new Date().toISOString() },
      });
      if (items.length !== 1) throw new MemoryUnavailableError('Mem0 did not confirm exactly one workout memory. Check Qdrant before retrying.');
      this.observe(items);
      return items[0]!.id;
    });
  }

  async storeSessions(userId: string, sessions: WorkoutMemoryInput[]): Promise<string[]> {
    const ids: string[] = [];
    for (const session of sessions) ids.push(await this.storeSession(userId, session));
    return ids;
  }

  async searchRelevant(userId: string, { query, targetMuscles = [], limit = 5 }: {
    query: string; targetMuscles?: string[]; limit?: number;
  }): Promise<RetrievedMemory[]> {
    const items = await this.adapter.search(userId, [query, ...targetMuscles].join(' ').trim() || 'completed training history', { scope: 'workout', limit });
    this.observe(items);
    return items.map(item => {
      const session = this.session(item);
      return { ...session, score: item.score ?? 0,
        daysAgo: Math.max(0, Math.floor((Date.now() - Date.parse(session.completedAt)) / 86_400_000)),
        matchedTerms: [], // Similarity comes from Mem0; no legacy keyword scoring.
      };
    });
  }

  private async allSessions(userId: string) {
    // OSS 3.3.1 getAll has no cursor. Fail visibly rather than silently truncate counts/recent ordering.
    const items = await this.adapter.list(userId, { scope: 'workout', limit: 10_001 });
    if (items.length > 10_000) throw new MemoryUnavailableError('More than 10000 workout memories for this user. Upgrade the Mem0 adapter to paginated listing before listing/counting this account.');
    this.observe(items);
    return items;
  }

  async listRecent(userId: string, limit = 20): Promise<RecentWorkoutMemory[]> {
    return (await this.allSessions(userId)).map(item => this.session(item))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, Math.max(1, Math.min(limit, 100)));
  }

  async getUserSessionCount(userId: string): Promise<number> { return (await this.allSessions(userId)).length; }

  async rememberConversation(userId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, context: {
    sourceId: string; source?: string;
  }): Promise<StoredMemory[]> {
    const userMessages = messages.filter(message => message.role === 'user' && message.content.trim()).map(message => ({ ...message }));
    if (!userMessages.length) return [];
    if (!context.sourceId.trim()) throw new Error('Conversation memory requires a traceable sourceId.');
    const fingerprint = createHash('sha256').update(JSON.stringify({ userId, sourceId: context.sourceId, userMessages })).digest('hex');
    return this.serial(userId, async () => {
      const existing = await this.adapter.list(userId, { scope: 'conversation', metadata: { fingerprint }, limit: 100 });
      if (existing.length) return existing;
      return this.adapter.add(userId, userMessages, { scope: 'conversation', infer: true,
        metadata: { schemaVersion: 1, kind: 'conversation_fact', source: context.source || 'chat',
          sourceId: context.sourceId, fingerprint, sourceInput: userMessages, recordedAt: new Date().toISOString() } });
    });
  }

  async searchMemories(userId: string, query: string, options: { limit?: number } = {}): Promise<StoredMemory[]> {
    return this.adapter.search(userId, query.trim() || 'fitness goals preferences history', { scope: 'conversation', limit: options.limit || 8 });
  }

  async listMemories(userId: string, limit = 20): Promise<StoredMemory[]> {
    return this.adapter.list(userId, { limit: Math.max(1, Math.min(limit, 100)) });
  }

  async createMemory(userId: string, text: string): Promise<StoredMemory> {
    if (!text.trim() || text.length > 10_000) throw new Error('Memory text must contain 1 to 10000 characters.');
    const items = await this.serial(userId, () => this.adapter.add(userId, [{ role: 'user', content: text }], {
      scope: 'conversation', infer: false,
      metadata: { schemaVersion: 1, kind: 'manual_memory', source: 'memory-api', sourceId: crypto.randomUUID(),
        sourceInput: text, recordedAt: new Date().toISOString() },
    }));
    if (items.length !== 1) throw new MemoryUnavailableError('Mem0 did not confirm exactly one manual memory.');
    return items[0]!;
  }

  async updateMemory(userId: string, id: string, text: string): Promise<StoredMemory> {
    if (!text.trim() || text.length > 10_000) throw new Error('Memory text must contain 1 to 10000 characters.');
    return this.serial(userId, async () => {
      const current = await this.adapter.get(userId, id);
      const session = current.metadata.kind === 'workout_session'
        ? { ...workoutMemoryInputSchema.parse(current.metadata.session), notes: text.slice(0, 1000) } : undefined;
      const edit = { sourceId: crypto.randomUUID(), sourceInput: text, previousMemory: current.memory, recordedAt: new Date().toISOString() };
      const updated = await this.adapter.update(userId, id, text, {
        ...(session ? { session } : {}),
        lastUserEdit: edit,
        userEdits: [...(Array.isArray(current.metadata.userEdits) ? current.metadata.userEdits : []), edit],
      });
      this.observe([updated]);
      return updated;
    });
  }

  async deleteMemory(userId: string, id: string): Promise<void> {
    await this.serial(userId, () => this.adapter.delete(userId, id));
    this.observed.delete(id);
  }

  getSummary(): WorkoutMemorySummary {
    const sessions = [...this.observed.values()];
    return { totalStoredSessions: sessions.length, uniqueUsers: new Set(sessions.map(item => item.userId)).size,
      latestSessionAt: sessions.map(item => item.completedAt).sort().at(-1) || null };
  }
}

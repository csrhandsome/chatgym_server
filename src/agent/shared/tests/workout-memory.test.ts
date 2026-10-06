import { expect, test } from 'bun:test';
import { WorkoutMemoryStore, MemoryNotFoundError } from '../workout-memory-store';
import { createMemoryFixture, createSessions, seedSessions } from './fixtures';

test('Mem0 ingestion deduplicates concurrent writes and isolates users', async () => {
  const fixture = createMemoryFixture();
  try {
    const sessions = createSessions(100);
    const ids = await fixture.store.storeSessions('user-a', sessions);
    expect(await fixture.store.storeSessions('user-a', sessions)).toEqual(ids);
    expect(new Set(ids).size).toBe(100);
    expect(await fixture.store.getUserSessionCount('user-a')).toBe(100);
    expect(await fixture.store.getUserSessionCount('user-b')).toBe(0);
    const same = await Promise.all(Array.from({ length: 5 }, () => fixture.store.storeSession('user-b', sessions[0]!)));
    expect(new Set(same).size).toBe(1);
    expect(fixture.store.getSummary().totalStoredSessions).toBe(101);
    const restarted = new WorkoutMemoryStore(fixture.adapter);
    expect(await restarted.storeSession('user-a', sessions[0]!)).toBe(ids[0]!);
  } finally { fixture.close(); }
});

test('retrieval uses Mem0 scores, preserves contract fields, and isolates users', async () => {
  const fixture = createMemoryFixture();
  try {
    await fixture.store.storeSessions('user-a', createSessions(10));
    await fixture.store.storeSessions('user-b', createSessions(10, 'other'));
    const recent = await fixture.store.listRecent('user-a', 3);
    expect(recent).toHaveLength(3);
    expect(recent[0]!.completedAt > recent[1]!.completedAt).toBe(true);
    const matches = await fixture.store.searchRelevant('user-a', { query: 'muscle_gain', targetMuscles: ['胸'], limit: 3 });
    expect(matches).toHaveLength(3);
    expect(matches.every(item => item.score > 0 && item.matchedTerms.length === 0)).toBe(true);
    const otherIds = new Set((await fixture.store.listRecent('user-b')).map(item => item.id));
    expect(matches.every(item => !otherIds.has(item.id))).toBe(true);
    expect(await fixture.store.searchRelevant('missing', { query: '胸' })).toEqual([]);
    expect(fixture.adapter.calls.some(call => call.operation === 'search')).toBe(true);
  } finally { fixture.close(); }
});

test('memory input, user edits and deletion remain traceable and scoped', async () => {
  const fixture = createMemoryFixture();
  try {
    const id = await fixture.store.storeSession('alice', createSessions(1)[0]!);
    await expect(fixture.store.updateMemory('bob', id, 'private')).rejects.toBeInstanceOf(MemoryNotFoundError);
    await expect(fixture.store.deleteMemory('bob', id)).rejects.toBeInstanceOf(MemoryNotFoundError);
    const updated = await fixture.store.updateMemory('alice', id, '恢复良好');
    expect(updated.metadata.sourceInput).toEqual(createSessions(1)[0]!);
    expect((await fixture.store.listRecent('alice'))[0]!.notes).toBe('恢复良好');
    expect(updated.metadata.lastUserEdit).toMatchObject({ sourceInput: '恢复良好' });
    await fixture.store.deleteMemory('alice', id);
    expect(await fixture.store.getUserSessionCount('alice')).toBe(0);
    expect(await fixture.store.searchRelevant('alice', { query: '胸' })).toEqual([]);
  } finally { fixture.close(); }
});

test('chat extraction sends only user facts and manual creation preserves exact input', async () => {
  const fixture = createMemoryFixture();
  try {
    const context = { sourceId: 'chat-request-1', source: 'planning_chat' };
    const messages = [{ role: 'user' as const, content: '我更喜欢早晨训练' }, { role: 'assistant' as const, content: '每天跑步10公里' }];
    const items = await fixture.store.rememberConversation('alice', messages, context);
    expect(await fixture.store.rememberConversation('alice', messages, context)).toEqual(items);
    expect(items[0]!.metadata.sourceInput).toEqual([{ role: 'user', content: '我更喜欢早晨训练' }]);
    expect(fixture.adapter.calls.filter(call => call.operation === 'add')).toHaveLength(1);
    expect(await fixture.store.searchMemories('bob', '早晨')).toEqual([]);
    const manual = await fixture.store.createMemory('alice', '周二不能训练');
    expect(manual.memory).toBe('周二不能训练');
    expect(manual.metadata.kind).toBe('manual_memory');
    expect((await fixture.store.searchMemories('alice', '早晨', { limit: 1 }))[0]!.id).toBe(items[0]!.id);
  } finally { fixture.close(); }
});

test('cached health summary does not invoke Mem0 after seeding', async () => {
  const fixture = createMemoryFixture();
  try {
    await seedSessions(fixture.store, 1000);
    const before = fixture.adapter.calls.length;
    expect(fixture.store.getSummary()).toEqual({ totalStoredSessions: 1000, uniqueUsers: 10,
      latestSessionAt: new Date(Date.UTC(2026, 0, 1) + 999 * 60_000).toISOString() });
    expect(fixture.adapter.calls.length).toBe(before);
    expect(await fixture.store.getUserSessionCount('user-0')).toBe(100);
  } finally { fixture.close(); }
});

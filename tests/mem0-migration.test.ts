import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLegacyMemory, rollbackMigration } from '../scripts/migrate-workout-memory';
import { FakeMem0Adapter } from './helpers/fake-mem0-adapter';

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'chatgym-mem0-migrate-'));
  const sourcePath = join(dir, 'legacy.sqlite');
  const db = new Database(sourcePath);
  db.exec(`CREATE TABLE workout_sessions (id TEXT, user_id TEXT, session_at TEXT, session_type TEXT, duration_minutes INTEGER,
    exercise_names_json TEXT, muscle_groups_json TEXT, intensity TEXT, goal_tag TEXT, notes TEXT)`);
  db.query('INSERT INTO workout_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('legacy-row-1', 'old-map-user', '2026-10-01T10:00:00.000Z', 'strength', 60, '["卧推"]', '["胸"]', 'medium', 'muscle_gain', 'legacy note');
  db.close();
  const original = readFileSync(sourcePath);
  const adapter = new FakeMem0Adapter();
  return { dir, original, sourcePath, backupPath: join(dir, 'backup.sqlite'), manifestPath: join(dir, 'manifest.json'), adapter,
    userMap: { 'old-map-user': 'stable-alice' }, close() { rmSync(dir, { recursive: true, force: true }); } };
};

test('migration backs up, validates mapping, is dry by default, and never modifies original SQLite', async () => {
  const f = fixture();
  try {
    const result = await migrateLegacyMemory(f);
    expect(result.dryRun).toBe(true); expect(result.manifest.entries).toHaveLength(1);
    expect(f.adapter.records.size).toBe(0);
    expect(readFileSync(f.sourcePath)).toEqual(f.original);
    expect(readFileSync(f.backupPath)).toEqual(f.original);
    const applied = await migrateLegacyMemory({ ...f, apply: true });
    expect(applied.imported).toBe(1);
    const again = await migrateLegacyMemory({ ...f, apply: true });
    expect(again.imported).toBe(0); expect(f.adapter.records.size).toBe(1);
    const item = [...f.adapter.records.values()][0]!;
    expect(item.userId).toBe('stable-alice');
    expect(item.metadata.provenance).toMatchObject({ legacyUserId: 'old-map-user', legacyId: 'legacy-row-1' });
    expect(readFileSync(f.sourcePath)).toEqual(f.original);
    expect(await rollbackMigration(f.manifestPath, f.adapter)).toEqual({ deleted: 1 });
    expect(await rollbackMigration(f.manifestPath, f.adapter)).toEqual({ deleted: 0 });
    expect(readFileSync(f.sourcePath)).toEqual(f.original);
  } finally { f.close(); }
});

test('backup checksum and mapping changes block migration before remote writes', async () => {
  const f = fixture();
  try {
    await migrateLegacyMemory(f);
    await expect(migrateLegacyMemory({ ...f, userMap: { 'old-map-user': 'different' }, apply: true })).rejects.toThrow('mapping differs');
    writeFileSync(f.backupPath, 'tampered');
    await expect(migrateLegacyMemory({ ...f, apply: true })).rejects.toThrow('checksum mismatch');
    expect(f.adapter.records.size).toBe(0);
  } finally { f.close(); }
});

test('unmapped old Map auth identities require explicit operator choice', async () => {
  const f = fixture();
  try {
    await expect(migrateLegacyMemory({ ...f, userMap: undefined })).rejects.toThrow('Every legacy user ID');
    expect(f.adapter.records.size).toBe(0);
    // Correct the mapping without deleting/recreating the previously made backup.
    expect((await migrateLegacyMemory(f)).manifest.entries).toHaveLength(1);
    expect(readFileSync(f.sourcePath)).toEqual(f.original);
  } finally { f.close(); }
});

test('read-only backup includes committed WAL records without changing original DB bytes', async () => {
  const f = fixture();
  const writer = new Database(f.sourcePath);
  try {
    writer.exec('PRAGMA journal_mode = WAL;');
    writer.query('INSERT INTO workout_sessions SELECT ?, user_id, session_at, session_type, duration_minutes, exercise_names_json, muscle_groups_json, intensity, goal_tag, notes FROM workout_sessions LIMIT 1').run('wal-row-2');
    const original = readFileSync(f.sourcePath);
    const result = await migrateLegacyMemory(f);
    expect(result.manifest.entries).toHaveLength(2);
    expect(readFileSync(f.sourcePath)).toEqual(original);
    const snapshot = new Database(f.backupPath, { readonly: true });
    try { expect(snapshot.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM workout_sessions').get()!.n).toBe(2); }
    finally { snapshot.close(); }
  } finally { writer.close(); f.close(); }
});

test('interrupted writes reconcile by fingerprint and rollback preserves later user edits', async () => {
  const f = fixture();
  try {
    const realAdd = f.adapter.add.bind(f.adapter);
    let interrupted = true;
    f.adapter.add = async (...args) => { const result = await realAdd(...args); if (interrupted) { interrupted = false; throw new Error('simulated crash after write'); } return result; };
    await expect(migrateLegacyMemory({ ...f, apply: true })).rejects.toThrow('simulated crash');
    expect(f.adapter.records.size).toBe(1);
    const restarted = await migrateLegacyMemory({ ...f, apply: true });
    expect(restarted.imported).toBe(0);
    const item = [...f.adapter.records.values()][0]!;
    await f.adapter.update(item.userId, item.id, 'user changed note', { lastUserEdit: { sourceInput: 'new note' } });
    await expect(rollbackMigration(f.manifestPath, f.adapter)).rejects.toThrow('edited after import');
    expect(f.adapter.records.size).toBe(1);
  } finally { f.close(); }
});

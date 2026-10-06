import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Mem0OssAdapter, type Mem0Adapter } from '../src/agent/shared/mem0-adapter';
import { WorkoutMemoryStore, workoutFingerprint } from '../src/agent/shared/workout-memory-store';
import { workoutMemoryInputSchema, type WorkoutMemoryInput } from '../src/agent/shared/types';

interface LegacyRow {
  id: string; user_id: string; session_at: string; session_type: string; duration_minutes: number;
  exercise_names_json: string; muscle_groups_json: string; intensity: string; goal_tag: string | null; notes: string | null;
}
export interface MigrationEntry {
  legacyId: string; userId: string; fingerprint: string; memoryId?: string;
  state: 'planned' | 'existing' | 'imported' | 'rolled_back';
}
export interface MigrationManifest {
  version: 1; migrationId: string; sourcePath: string; backupPath: string; backupSha256: string;
  collection: string; entries: MigrationEntry[];
}
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sessionFromRow = (row: LegacyRow): WorkoutMemoryInput => workoutMemoryInputSchema.parse({
  completedAt: row.session_at, sessionType: row.session_type, durationMinutes: row.duration_minutes,
  exerciseNames: JSON.parse(row.exercise_names_json), muscleGroups: JSON.parse(row.muscle_groups_json),
  intensity: row.intensity, goalTag: row.goal_tag ?? undefined, notes: row.notes ?? undefined,
  // The old DB did not retain original sourceId; retain its stable row ID instead.
  sourceId: `legacy:${row.id}`,
});
const saveManifest = (path: string, manifest: MigrationManifest) => {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
};

export const backupLegacyDatabase = (sourcePath: string, backupPath: string) => {
  if (resolve(sourcePath) === resolve(backupPath)) throw new Error('Backup must use a different path from the original database.');
  if (existsSync(backupPath)) throw new Error('Backup already exists. Choose a new backup path or resume the existing manifest.');
  mkdirSync(dirname(backupPath), { recursive: true });
  const source = new Database(sourcePath, { readonly: true });
  try {
    // SQLite serialization includes committed WAL state; copying only the .sqlite file would not.
    const snapshot = source.serialize();
    writeFileSync(backupPath, snapshot, { flag: 'wx', mode: 0o600 });
    return sha256(snapshot);
  } finally { source.close(); }
};

export const migrateLegacyMemory = async (options: {
  sourcePath: string; backupPath: string; manifestPath: string;
  adapter: Mem0Adapter; apply?: boolean; preserveUserIds?: boolean;
  userMap?: Record<string, string>; collection?: string;
}) => {
  const sourcePath = resolve(options.sourcePath), backupPath = resolve(options.backupPath), manifestPath = resolve(options.manifestPath);
  if (manifestPath === sourcePath || manifestPath === backupPath) throw new Error('Manifest must use a separate path.');
  mkdirSync(dirname(manifestPath), { recursive: true });
  const lockPath = `${manifestPath}.lock`;
  const lock = openSync(lockPath, 'wx', 0o600);
  try {
    let manifest: MigrationManifest;
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.version !== 1 || manifest.sourcePath !== sourcePath || manifest.backupPath !== backupPath
        || manifest.collection !== (options.collection || process.env.MEM0_COLLECTION || 'chatgym_memories_v1')) throw new Error('Manifest source/backup/collection mismatch.');
      if (sha256(readFileSync(backupPath)) !== manifest.backupSha256) throw new Error('Backup checksum mismatch. Do not migrate a modified backup.');
    } else {
      const backupSha256 = backupLegacyDatabase(sourcePath, backupPath);
      manifest = { version: 1, migrationId: crypto.randomUUID(), sourcePath, backupPath, backupSha256,
        collection: options.collection || process.env.MEM0_COLLECTION || 'chatgym_memories_v1', entries: [] };
      // Keep a resumable backup binding even if later row/mapping validation fails.
      saveManifest(manifestPath, manifest);
    }
    const backup = new Database(backupPath, { readonly: true });
    let rows: LegacyRow[];
    try {
      const integrity = backup.query('PRAGMA integrity_check').get() as Record<string, unknown>;
      if (!Object.values(integrity).every(value => value === 'ok')) throw new Error('SQLite backup integrity check failed.');
      rows = backup.query<LegacyRow, []>('SELECT * FROM workout_sessions ORDER BY id').all();
    } finally { backup.close(); }
    // Validate ALL data and user mappings before the first remote write.
    const sessions = rows.map(row => {
      const userId = options.userMap?.[row.user_id] || (options.preserveUserIds ? row.user_id : undefined);
      if (!userId?.trim()) throw new Error('Every legacy user ID needs --user-map, or explicitly choose --preserve-user-ids. See docs/mem0.md.');
      return { row, userId, session: sessionFromRow(row) };
    });
    for (const { row, userId, session } of sessions) {
      const fingerprint = workoutFingerprint(userId, session);
      const existing = manifest.entries.find(entry => entry.legacyId === row.id);
      if (existing && (existing.userId !== userId || existing.fingerprint !== fingerprint)) throw new Error('User mapping differs from the existing migration manifest.');
      if (!existing) manifest.entries.push({ legacyId: row.id, userId, fingerprint, state: 'planned' });
    }
    saveManifest(manifestPath, manifest);
    if (!options.apply) return { manifest, dryRun: true, imported: 0 };
    const store = new WorkoutMemoryStore(options.adapter);
    let imported = 0;
    for (const { row, userId, session } of sessions) {
      const entry = manifest.entries.find(item => item.legacyId === row.id)!;
      const found = (await options.adapter.list(userId, { scope: 'workout', metadata: { fingerprint: entry.fingerprint }, limit: 1 }))[0];
      if (found) {
        const provenance = found.metadata.provenance as { migrationId?: string } | undefined;
        entry.memoryId = found.id;
        entry.state = provenance?.migrationId === manifest.migrationId ? 'imported' : 'existing';
        saveManifest(manifestPath, manifest);
        continue;
      }
      // Persist intent before writing; restart reconciles by fingerprint + migrationId.
      entry.state = 'planned'; saveManifest(manifestPath, manifest);
      entry.memoryId = await store.storeSession(userId, session, { migrationId: manifest.migrationId,
        legacyId: row.id, legacyUserId: row.user_id, backupSha256: manifest.backupSha256 });
      entry.state = 'imported'; imported++;
      saveManifest(manifestPath, manifest);
    }
    return { manifest, dryRun: false, imported };
  } finally { closeSync(lock); unlinkSync(lockPath); }
};

export const rollbackMigration = async (manifestPath: string, adapter: Mem0Adapter, collection = process.env.MEM0_COLLECTION || 'chatgym_memories_v1') => {
  const manifest: MigrationManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.collection !== collection) throw new Error('Rollback collection does not match the manifest.');
  if (sha256(readFileSync(manifest.backupPath)) !== manifest.backupSha256) throw new Error('Backup checksum mismatch.');
  const lockPath = `${manifestPath}.lock`;
  const lock = openSync(lockPath, 'wx', 0o600);
  let deleted = 0;
  try {
    for (const entry of manifest.entries) {
      if (entry.state === 'existing' || entry.state === 'rolled_back') continue;
      const found = (await adapter.list(entry.userId, { scope: 'workout', metadata: { fingerprint: entry.fingerprint }, limit: 1 }))[0];
      if (found) {
        const provenance = found.metadata.provenance as { migrationId?: string } | undefined;
        if (provenance?.migrationId !== manifest.migrationId) continue;
        // Preserve memories a user edited after migration.
        if (found.metadata.lastUserEdit) throw new Error('A migrated memory was edited after import. Resolve it before rollback.');
        await adapter.delete(entry.userId, found.id); deleted++;
      }
      entry.state = 'rolled_back'; saveManifest(manifestPath, manifest);
    }
    return { deleted };
  } finally { closeSync(lock); unlinkSync(lockPath); }
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  try {
    if (arg('--rollback')) {
      console.log(JSON.stringify(await rollbackMigration(resolve(arg('--rollback')!), new Mem0OssAdapter())));
    } else {
      const sourcePath = arg('--source') || 'src/agent/data/workout-memory.sqlite';
      const backupPath = arg('--backup'), manifestPath = arg('--manifest');
      if (!backupPath || !manifestPath) throw new Error('Required: --backup <new snapshot.sqlite> --manifest <manifest.json>. Default is dry run; add --apply to import.');
      const result = await migrateLegacyMemory({ sourcePath, backupPath, manifestPath,
        adapter: new Mem0OssAdapter(), apply: args.includes('--apply'), preserveUserIds: args.includes('--preserve-user-ids'),
        userMap: arg('--user-map') ? JSON.parse(readFileSync(arg('--user-map')!, 'utf8')) : undefined });
      console.log(JSON.stringify({ dryRun: result.dryRun, records: result.manifest.entries.length, imported: result.imported, manifestPath }));
    }
  } catch (error) {
    // All provider errors are sanitized by Mem0OssAdapter.
    console.error(error instanceof Error ? error.message : 'Memory migration failed.');
    process.exitCode = 1;
  }
}

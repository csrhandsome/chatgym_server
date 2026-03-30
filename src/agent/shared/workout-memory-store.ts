import { Database } from 'bun:sqlite';
import type { RetrievedMemory, WorkoutMemoryInput } from './types';

interface WorkoutSessionRow {
  id: string;
  user_id: string;
  fingerprint: string;
  session_at: string;
  session_type: string;
  duration_minutes: number;
  exercise_names_json: string;
  muscle_groups_json: string;
  intensity: string;
  goal_tag: string | null;
  notes: string | null;
  created_at: string;
}

export interface WorkoutMemorySummary {
  readonly totalStoredSessions: number;
  readonly uniqueUsers: number;
  readonly latestSessionAt: string | null;
}

const DEFAULT_DB_PATH = new URL('../data/workout-memory.sqlite', import.meta.url).pathname;

const normalizeToken = (value: string) => value.toLowerCase().trim();

const tokenize = (value: string) =>
  normalizeToken(value)
    .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
    .filter(Boolean);

const daysBetween = (now: Date, isoDate: string) => {
  const sessionDate = new Date(isoDate);
  const diffMs = Math.max(0, now.getTime() - sessionDate.getTime());

  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
};

const parseRow = (row: WorkoutSessionRow): Omit<RetrievedMemory, 'score' | 'daysAgo' | 'matchedTerms'> => ({
  id: row.id,
  completedAt: row.session_at,
  sessionType: row.session_type as RetrievedMemory['sessionType'],
  durationMinutes: row.duration_minutes,
  exerciseNames: JSON.parse(row.exercise_names_json) as string[],
  muscleGroups: JSON.parse(row.muscle_groups_json) as string[],
  intensity: row.intensity as RetrievedMemory['intensity'],
  goalTag: row.goal_tag,
  notes: row.notes,
});

const buildFingerprint = (userId: string, input: WorkoutMemoryInput) =>
  new Bun.CryptoHasher('sha1')
    .update(
      JSON.stringify({
        userId,
        sourceId: input.sourceId ?? null,
        completedAt: input.completedAt,
        sessionType: input.sessionType,
        durationMinutes: input.durationMinutes,
        exerciseNames: [...input.exerciseNames].sort(),
      }),
    )
    .digest('hex');

export class WorkoutMemoryStore {
  private readonly db: Database;

  constructor(path = DEFAULT_DB_PATH) {
    this.db = new Database(path, { create: true });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workout_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        session_at TEXT NOT NULL,
        session_type TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        exercise_names_json TEXT NOT NULL,
        muscle_groups_json TEXT NOT NULL,
        intensity TEXT NOT NULL,
        goal_tag TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workout_sessions_user_time
        ON workout_sessions (user_id, session_at DESC);
    `);
  }

  storeSessions(userId: string, sessions: WorkoutMemoryInput[]): string[] {
    const ids: string[] = [];

    for (const session of sessions) {
      ids.push(this.storeSession(userId, session));
    }

    return ids;
  }

  storeSession(userId: string, session: WorkoutMemoryInput): string {
    const fingerprint = buildFingerprint(userId, session);
    const existing = this.db
      .query<{ id: string }, [string]>('SELECT id FROM workout_sessions WHERE fingerprint = ?')
      .get(fingerprint);

    if (existing) {
      return existing.id;
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.db
      .query(
        `
          INSERT INTO workout_sessions (
            id,
            user_id,
            fingerprint,
            session_at,
            session_type,
            duration_minutes,
            exercise_names_json,
            muscle_groups_json,
            intensity,
            goal_tag,
            notes,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        userId,
        fingerprint,
        session.completedAt,
        session.sessionType,
        session.durationMinutes,
        JSON.stringify(session.exerciseNames),
        JSON.stringify(session.muscleGroups),
        session.intensity,
        session.goalTag ?? null,
        session.notes ?? null,
        createdAt,
      );

    return id;
  }

  searchRelevant(
    userId: string,
    {
      query,
      targetMuscles = [],
      limit = 5,
    }: {
      query: string;
      targetMuscles?: string[];
      limit?: number;
    },
  ): RetrievedMemory[] {
    const rows = this.db
      .query<WorkoutSessionRow, [string]>(
        `
          SELECT *
          FROM workout_sessions
          WHERE user_id = ?
          ORDER BY session_at DESC
          LIMIT 80
        `,
      )
      .all(userId);

    const now = new Date();
    const queryTokens = new Set(tokenize([query, ...targetMuscles].join(' ')));
    const targetSet = new Set(targetMuscles.map(normalizeToken));

    return rows
      .map((row) => {
        const parsed = parseRow(row);
        const documentTokens = new Set(
          tokenize(
            [
              parsed.sessionType,
              parsed.goalTag ?? '',
              parsed.notes ?? '',
              ...parsed.exerciseNames,
              ...parsed.muscleGroups,
            ].join(' '),
          ),
        );
        const matchedTerms = [...queryTokens].filter((token) => documentTokens.has(token));
        const directMuscleMatches = parsed.muscleGroups.filter((muscle) =>
          targetSet.has(normalizeToken(muscle)),
        );
        const daysAgo = daysBetween(now, parsed.completedAt);
        const recencyScore =
          daysAgo <= 7 ? 5 : daysAgo <= 30 ? 4 : daysAgo <= 90 ? 3 : daysAgo <= 180 ? 2 : 1;
        const score = matchedTerms.length * 4 + directMuscleMatches.length * 3 + recencyScore;

        return {
          ...parsed,
          score,
          daysAgo,
          matchedTerms,
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.completedAt.localeCompare(left.completedAt);
      })
      .slice(0, limit);
  }

  listRecent(userId: string, limit = 20): Omit<RetrievedMemory, 'score' | 'daysAgo' | 'matchedTerms'>[] {
    return this.db
      .query<WorkoutSessionRow, [string, number]>(
        `
          SELECT *
          FROM workout_sessions
          WHERE user_id = ?
          ORDER BY session_at DESC
          LIMIT ?
        `,
      )
      .all(userId, limit)
      .map(parseRow);
  }

  getUserSessionCount(userId: string): number {
    const row = this.db
      .query<{ total: number }, [string]>(
        'SELECT COUNT(*) AS total FROM workout_sessions WHERE user_id = ?',
      )
      .get(userId);

    return row?.total ?? 0;
  }

  getSummary(): WorkoutMemorySummary {
    const row = this.db
      .query<WorkoutMemorySummary, []>(
        `
          SELECT
            COUNT(*) AS totalStoredSessions,
            COUNT(DISTINCT user_id) AS uniqueUsers,
            MAX(session_at) AS latestSessionAt
          FROM workout_sessions
        `,
      )
      .get();

    return {
      totalStoredSessions: row?.totalStoredSessions ?? 0,
      uniqueUsers: row?.uniqueUsers ?? 0,
      latestSessionAt: row?.latestSessionAt ?? null,
    };
  }
}

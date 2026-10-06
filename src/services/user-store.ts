import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PublicUser } from '../types/auth';

interface UserRecord {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt: string | null;
}

interface CreateUserInput {
  username: string;
  passwordHash: string;
}

interface UserStoreSummary {
  usersCount: number;
}

const normalizeUsername = (username: string) => username.trim().toLowerCase();

const cloneUser = (user: UserRecord): UserRecord => ({ ...user });
const userColumns = 'id, username, usernameKey, passwordHash, createdAt, lastLoginAt';

export const toPublicUser = (user: UserRecord): PublicUser => ({
  id: user.id,
  username: user.username,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});

export class UserStore {
  private readonly database: Database;

  // Tests get isolated databases; production passes its persistent account path.
  constructor(databasePath = ':memory:') {
    const persistent = databasePath !== ':memory:' && databasePath !== '';

    if (persistent) {
      mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    }

    this.database = new Database(databasePath, { create: true, strict: true });

    try {
      if (persistent) {
        // Account hashes belong in a private database, including existing files.
        chmodSync(databasePath, 0o600);
      }

      this.database.run('PRAGMA busy_timeout = 5000');
      this.database.run('PRAGMA journal_mode = WAL');
      this.database.run('PRAGMA synchronous = FULL');
      this.database.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY NOT NULL,
          username TEXT NOT NULL,
          usernameKey TEXT NOT NULL UNIQUE CHECK (length(usernameKey) > 0),
          passwordHash TEXT NOT NULL,
          createdAt TEXT NOT NULL,
          lastLoginAt TEXT
        )
      `);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  create(input: CreateUserInput): UserRecord | undefined {
    const username = input.username.trim();
    const usernameKey = normalizeUsername(username);

    if (!usernameKey) {
      return undefined;
    }

    const user: UserRecord = {
      id: crypto.randomUUID(),
      username,
      usernameKey,
      passwordHash: input.passwordHash,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };

    // SQLite enforces uniqueness at the write, across connections and processes.
    // A conflicting registration must never replace the original identity/hash.
    const result = this.database.query(`
      INSERT INTO users (${userColumns}) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(usernameKey) DO NOTHING
    `).run(user.id, user.username, user.usernameKey, user.passwordHash, user.createdAt, null);

    return result.changes === 1 ? cloneUser(user) : undefined;
  }

  findByUsername(username: string): UserRecord | undefined {
    const user = this.database.query<UserRecord, [string]>(
      `SELECT ${userColumns} FROM users WHERE usernameKey = ?`,
    ).get(normalizeUsername(username));

    return user ? cloneUser(user) : undefined;
  }

  getById(id: string): UserRecord | undefined {
    const user = this.database.query<UserRecord, [string]>(
      `SELECT ${userColumns} FROM users WHERE id = ?`,
    ).get(id);

    return user ? cloneUser(user) : undefined;
  }

  markLogin(id: string): UserRecord | undefined {
    const user = this.database.query<UserRecord, [string, string]>(`
      UPDATE users SET lastLoginAt = ? WHERE id = ? RETURNING ${userColumns}
    `).get(new Date().toISOString(), id);

    return user ? cloneUser(user) : undefined;
  }

  getSummary(): UserStoreSummary {
    return this.database.query<UserStoreSummary, []>(
      'SELECT COUNT(*) AS usersCount FROM users',
    ).get()!;
  }

  close(): void {
    this.database.close();
  }
}

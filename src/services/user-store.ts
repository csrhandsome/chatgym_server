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

export const toPublicUser = (user: UserRecord): PublicUser => ({
  id: user.id,
  username: user.username,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
});

export class UserStore {
  private readonly usersById = new Map<string, UserRecord>();
  private readonly userIdsByUsername = new Map<string, string>();

  create(input: CreateUserInput): UserRecord | undefined {
    const username = input.username.trim();
    const usernameKey = normalizeUsername(username);

    if (!usernameKey || this.userIdsByUsername.has(usernameKey)) {
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

    this.usersById.set(user.id, user);
    this.userIdsByUsername.set(usernameKey, user.id);

    return cloneUser(user);
  }

  findByUsername(username: string): UserRecord | undefined {
    const usernameKey = normalizeUsername(username);
    const userId = this.userIdsByUsername.get(usernameKey);

    if (!userId) {
      return undefined;
    }

    const user = this.usersById.get(userId);

    return user ? cloneUser(user) : undefined;
  }

  getById(id: string): UserRecord | undefined {
    const user = this.usersById.get(id);

    return user ? cloneUser(user) : undefined;
  }

  markLogin(id: string): UserRecord | undefined {
    const user = this.usersById.get(id);

    if (!user) {
      return undefined;
    }

    user.lastLoginAt = new Date().toISOString();

    return cloneUser(user);
  }

  getSummary(): UserStoreSummary {
    return {
      usersCount: this.usersById.size,
    };
  }
}

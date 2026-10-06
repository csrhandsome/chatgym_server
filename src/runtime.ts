import { WorkoutMemoryStore } from './agent/shared/workout-memory-store';
import { resolve } from 'node:path';
import { TextStore } from './services/text-store';
import { TextStreamHub } from './services/text-stream-hub';
import { UserStore } from './services/user-store';

export interface ServerRuntime {
  readonly serviceName: string;
  readonly startedAt: Date;
  readonly textStore: TextStore;
  readonly textStreamHub: TextStreamHub;
  readonly userStore: UserStore;
  readonly workoutMemoryStore: WorkoutMemoryStore;
}

export const createRuntime = (overrides: Partial<ServerRuntime> = {}): ServerRuntime => ({
  serviceName: overrides.serviceName ?? 'chatgym_server',
  startedAt: overrides.startedAt ?? new Date(),
  textStore: overrides.textStore ?? new TextStore(),
  textStreamHub: overrides.textStreamHub ?? new TextStreamHub(),
  userStore: overrides.userStore ?? new UserStore(Bun.env.AUTH_DB_PATH || resolve('.data/users.sqlite')),
  workoutMemoryStore: overrides.workoutMemoryStore ?? new WorkoutMemoryStore(),
});

export const buildRuntimeSnapshot = (runtime: ServerRuntime) => ({
  auth: runtime.userStore.getSummary(),
  agent: runtime.workoutMemoryStore.getSummary(),
  text: runtime.textStore.getSummary(),
  ws: runtime.textStreamHub.getSummary(),
});

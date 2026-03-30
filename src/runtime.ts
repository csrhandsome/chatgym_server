import { WorkoutMemoryStore } from './agent/shared/workout-memory-store';
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

export const createRuntime = (): ServerRuntime => ({
  serviceName: 'chatgym_server',
  startedAt: new Date(),
  textStore: new TextStore(),
  textStreamHub: new TextStreamHub(),
  userStore: new UserStore(),
  workoutMemoryStore: new WorkoutMemoryStore(),
});

export const buildRuntimeSnapshot = (runtime: ServerRuntime) => ({
  auth: runtime.userStore.getSummary(),
  agent: runtime.workoutMemoryStore.getSummary(),
  text: runtime.textStore.getSummary(),
  ws: runtime.textStreamHub.getSummary(),
});

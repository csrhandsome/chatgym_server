import { createRuntime } from '../../../runtime';
import { UserStore } from '../../../services/user-store';
import { FakeMem0Adapter } from '../../../../tests/helpers/fake-mem0-adapter';
import { WorkoutMemoryStore } from '../workout-memory-store';

export const createWorkflowHarness = () => {
  const adapter = new FakeMem0Adapter();
  const userStore = new UserStore();
  const runtime = createRuntime({
    userStore,
    workoutMemoryStore: new WorkoutMemoryStore(adapter),
  });
  return { runtime, adapter, close() { userStore.close(); } };
};

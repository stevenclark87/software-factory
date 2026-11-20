// Fixture: Date.now() inside workflow code. The sandbox replaces it with deterministic workflow time.
import { sleep } from '@temporalio/workflow';

export async function clockWorkflow(): Promise<{ before: number; after: number }> {
  const before = Date.now();
  await sleep('1 hour');
  const after = Date.now();
  return { before, after };
}

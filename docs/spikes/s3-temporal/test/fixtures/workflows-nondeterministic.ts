// Fixture: v2 that adds an UNPATCHED timer before greet. This changes the command sequence, so replaying
// the v1 history must fail with a nondeterminism error.
import { ApplicationFailure } from '@temporalio/common';
import { condition, defineQuery, defineSignal, proxyActivities, setHandler, sleep, workflowInfo } from '@temporalio/workflow';
import type * as activities from '../../src/activities';
import type { RunKey } from '../../src/activities';

const { greet } = proxyActivities<typeof activities>({ startToCloseTimeout: '30 seconds', retry: { maximumAttempts: 3 } });
export const approveSignal = defineSignal<[string]>('approve');
export const statusQuery = defineQuery<string>('status');

export async function helloWorkflow(input: { name: string; approvalTimeoutMs: number }): Promise<string> {
  let approvedBy: string | undefined;
  let status = 'waiting-for-approval';
  setHandler(approveSignal, (approver: string) => { approvedBy = approver; });
  setHandler(statusQuery, () => status);
  const approved = await condition(() => approvedBy !== undefined, input.approvalTimeoutMs);
  if (!approved) {
    status = 'timed-out';
    throw ApplicationFailure.nonRetryable('no approval signal received before timeout', 'ApprovalTimeout');
  }
  await sleep('1 second'); // new timer command, not patched
  status = 'running-greet';
  const runKey: RunKey = { workflowId: workflowInfo().workflowId, stepId: 'greet', attempt: 1 };
  const greeting = await greet({ runKey, name: input.name, approvedBy: approvedBy! });
  status = 'done';
  return greeting;
}

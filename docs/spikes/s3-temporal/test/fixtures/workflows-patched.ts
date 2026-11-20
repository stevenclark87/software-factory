// Fixture: v2 of helloWorkflow. Adds a patched() branch that changes NO commands, so histories recorded
// by v1 (no marker) must still replay. Copied from src/workflows.ts with one added patched() call.
import { ApplicationFailure } from '@temporalio/common';
import { condition, defineQuery, defineSignal, patched, proxyActivities, setHandler, workflowInfo, log } from '@temporalio/workflow';
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
  if (patched('log-before-greet')) {
    log.info('v2 branch: no command change');
  }
  status = 'running-greet';
  const runKey: RunKey = { workflowId: workflowInfo().workflowId, stepId: 'greet', attempt: 1 };
  const greeting = await greet({ runKey, name: input.name, approvedBy: approvedBy! });
  status = 'done';
  return greeting;
}

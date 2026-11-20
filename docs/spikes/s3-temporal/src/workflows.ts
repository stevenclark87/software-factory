// Deterministic workflow code. No I/O, no Date.now(), no Math.random(). All I/O goes through the activity.
import {
  ApplicationFailure,
} from '@temporalio/common';
import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from '@temporalio/workflow';
import type * as activities from './activities';
import type { RunKey } from './activities';

const { greet } = proxyActivities<typeof activities>({
  // Temporal requires a start-to-close timeout on every activity.
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 3 },
});

export const approveSignal = defineSignal<[string]>('approve');
export const statusQuery = defineQuery<string>('status');

export interface HelloInput {
  name: string;
  approvalTimeoutMs: number;
}

export async function helloWorkflow(input: HelloInput): Promise<string> {
  let approvedBy: string | undefined;
  let status = 'waiting-for-approval';

  setHandler(approveSignal, (approver: string) => {
    approvedBy = approver;
  });
  setHandler(statusQuery, () => status);

  const approved = await condition(() => approvedBy !== undefined, input.approvalTimeoutMs);
  if (!approved) {
    status = 'timed-out';
    throw ApplicationFailure.nonRetryable('no approval signal received before timeout', 'ApprovalTimeout');
  }

  status = 'running-greet';
  const runKey: RunKey = { workflowId: workflowInfo().workflowId, stepId: 'greet', attempt: 1 };
  const greeting = await greet({ runKey, name: input.name, approvedBy: approvedBy! });

  status = 'done';
  return greeting;
}

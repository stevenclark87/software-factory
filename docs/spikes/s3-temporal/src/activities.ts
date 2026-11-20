import { Context } from '@temporalio/activity';

// Run key = workflowId + stepId + attempt. The workflow owns workflowId, stepId and its own
// logical attempt counter. Temporal's activity retry number is NOT part of the key (see finding).
export interface RunKey {
  workflowId: string;
  stepId: string;
  attempt: number;
}

export interface GreetArgs {
  runKey: RunKey;
  name: string;
  approvedBy: string;
}

export async function greet(args: GreetArgs): Promise<string> {
  const { info } = Context.current();
  const { runKey } = args;
  console.log(
    `[greet] runKey=${runKey.workflowId}/${runKey.stepId}/${runKey.attempt} ` +
      `activityAttempt=${info.attempt} activityType=${info.activityType}`,
  );
  return `Hello, ${args.name}! Approved by ${args.approvedBy}.`;
}

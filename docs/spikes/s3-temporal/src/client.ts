import { Client, Connection } from '@temporalio/client';
import { TASK_QUEUE } from './constants';
import { approveSignal, helloWorkflow, statusQuery } from './workflows';

async function main(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const connection = await Connection.connect({ address });
  const client = new Client({ connection });

  const workflowId = `hello-s3-${Date.now()}`; // client-side: fine, not workflow code
  const handle = await client.workflow.start(helloWorkflow, {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{ name: 'Origami', approvalTimeoutMs: 600_000 }],
  });
  console.log(`[client] started workflowId=${handle.workflowId} runId=${handle.firstExecutionRunId}`);
  console.log(`[client] query status (before signal): ${await handle.query(statusQuery)}`);

  await handle.signal(approveSignal, 'sclark');
  console.log('[client] sent signal approve(sclark)');

  const result = await handle.result();
  console.log(`[client] result: ${result}`);
  console.log(`[client] query status (after): ${await handle.query(statusQuery)}`);

  // Observed: without this the process stays alive after close() (native runtime handles, SDK 1.26.0 on Node 20).
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

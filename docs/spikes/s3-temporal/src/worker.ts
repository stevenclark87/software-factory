import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';

import { TASK_QUEUE } from './constants';


async function main(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    // Bundled with webpack and run in the V8 workflow sandbox.
    workflowsPath: require.resolve('./workflows'),
    activities,
  });
  console.log(`[worker] polling ${TASK_QUEUE} at ${address}`);
  await worker.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

describe('workflow sandbox', () => {
  let env: TestWorkflowEnvironment;
  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);
  afterAll(async () => {
    await env?.teardown();
  });

  it('Date.now() inside a workflow is replaced with workflow (virtual) time and advances with timers', async () => {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'sandbox-clock',
      workflowsPath: resolve(__dirname, 'fixtures/workflows-clock.ts'),
      activities: {},
    });
    await worker.runUntil(async () => {
      const r = await env.client.workflow.execute('clockWorkflow', { taskQueue: 'sandbox-clock', workflowId: 'clock-1' });
      // Virtual clock advanced by the 1h timer. Observed delta 3600032 ms, not exactly 3600000:
      // the test server fires timers slightly late. So assert a tolerance, not equality.
      const delta = r.after - r.before;
      expect(delta).toBeGreaterThanOrEqual(60 * 60 * 1000);
      expect(delta).toBeLessThan(60 * 60 * 1000 + 60_000);
    });
  }, 120_000);

  it('node:fs import in workflow code is rejected at bundle time (Worker.create fails)', async () => {
    // Observed: webpack fails with "UnhandledSchemeError: Reading from node:fs is not handled by plugins".
    // The workflow never runs; the ban is a build-time guarantee, not a runtime sandbox error.
    await expect(
      Worker.create({
        connection: env.nativeConnection,
        taskQueue: 'sandbox-io',
        workflowsPath: resolve(__dirname, 'fixtures/workflows-banned-io.ts'),
        activities: {},
      }),
    ).rejects.toThrow(/node:fs|UnhandledSchemeError|Webpack/);
  }, 120_000);
});

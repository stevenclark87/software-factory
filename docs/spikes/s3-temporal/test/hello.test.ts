import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowFailedError } from '@temporalio/client';
import * as activities from '../src/activities';
import { approveSignal, helloWorkflow, statusQuery } from '../src/workflows';

const WORKFLOWS = resolve(__dirname, '../src/workflows.ts');

describe('helloWorkflow with TestWorkflowEnvironment (time skipping)', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  it('completes after signal and reports status via query', async () => {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'hello-s3-test',
      workflowsPath: WORKFLOWS,
      activities,
    });
    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(helloWorkflow, {
        taskQueue: 'hello-s3-test',
        workflowId: 'test-signal-path',
        args: [{ name: 'Test', approvalTimeoutMs: 24 * 60 * 60 * 1000 }],
      });
      expect(await handle.query(statusQuery)).toBe('waiting-for-approval');
      await handle.signal(approveSignal, 'tester');
      expect(await handle.result()).toBe('Hello, Test! Approved by tester.');
      expect(await handle.query(statusQuery)).toBe('done');
    });
  }, 120_000);

  it('fails with ApprovalTimeout when no signal arrives; the 24h timer is skipped', async () => {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: 'hello-s3-test',
      workflowsPath: WORKFLOWS,
      activities,
    });
    await worker.runUntil(async () => {
      const started = Date.now();
      const handle = await env.client.workflow.start(helloWorkflow, {
        taskQueue: 'hello-s3-test',
        workflowId: 'test-timeout-path',
        args: [{ name: 'Test', approvalTimeoutMs: 24 * 60 * 60 * 1000 }],
      });
      const err = await handle.result().catch((e) => e);
      expect(err).toBeInstanceOf(WorkflowFailedError);
      expect(String((err as WorkflowFailedError).cause?.message)).toContain('no approval signal');
      // Real wall time should be far below 24h: time skipping advanced the virtual clock.
      expect(Date.now() - started).toBeLessThan(60_000);
    });
  }, 120_000);
});

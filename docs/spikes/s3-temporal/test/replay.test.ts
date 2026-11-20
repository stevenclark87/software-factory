import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Worker } from '@temporalio/worker';

// History recorded from a real run via `temporal workflow show -o json` (see evidence/).
const EVIDENCE = resolve(__dirname, '../evidence');
const HISTORY_FILE = readdirSync(EVIDENCE).find((f) => f.startsWith('history-'))!;
const HISTORY = JSON.parse(readFileSync(resolve(EVIDENCE, HISTORY_FILE), 'utf8'));
const WORKFLOW_ID = HISTORY_FILE.replace(/^history-/, '').replace(/\.json$/, '');
const wf = (p: string) => resolve(__dirname, p);

describe('replay of a real recorded history', () => {
  it('replays cleanly against the current workflow code', async () => {
    await expect(
      Worker.runReplayHistory({ workflowsPath: wf('../src/workflows.ts') }, HISTORY, WORKFLOW_ID),
    ).resolves.toBeUndefined();
  }, 120_000);

  it('replays cleanly against a patched() variant (patch adds no commands)', async () => {
    await expect(
      Worker.runReplayHistory({ workflowsPath: wf('fixtures/workflows-patched.ts') }, HISTORY, WORKFLOW_ID),
    ).resolves.toBeUndefined();
  }, 120_000);

  it('detects nondeterminism when an unpatched timer is added before greet', async () => {
    await expect(
      Worker.runReplayHistory({ workflowsPath: wf('fixtures/workflows-nondeterministic.ts') }, HISTORY, WORKFLOW_ID),
    ).rejects.toThrow(/[Nn]ondeterminism|[Dd]eterminism/);
  }, 120_000);
});

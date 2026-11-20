// Replays recorded histories (evidence/*.json) against the current workflow code.
// Exits non-zero on any nondeterminism. Usage: node dist/replay.js [history.json ...]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from '@temporalio/worker';

async function main(): Promise<void> {
  const evidenceDir = join(__dirname, '..', 'evidence');
  const files =
    process.argv.length > 2
      ? process.argv.slice(2)
      : readdirSync(evidenceDir)
          .filter((f) => f.startsWith('history-') && f.endsWith('.json'))
          .map((f) => join(evidenceDir, f));

  for (const file of files) {
    // runReplayHistory accepts the raw protobuf-JSON object from `fetchHistory()` and converts it itself.
    const history = JSON.parse(readFileSync(file, 'utf8'));
    await Worker.runReplayHistory({ workflowsPath: require.resolve('./workflows') }, history, file);
    console.log(`[replay] OK ${file}`);
  }
}

main().catch((err) => {
  console.error('[replay] FAILED', err);
  process.exit(1);
});

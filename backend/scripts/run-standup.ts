// Checkpoint 4: the pipeline now pauses for a real human decision before
// posting, and resumes exactly where it left off — even from a brand-new
// process, since the suspended run's state is persisted (see
// src/mastra/index.ts's file-backed storage), not held in memory.
//
// Start a new run:              npx tsx scripts/run-standup.ts
// Resume a paused run:          npx tsx scripts/run-standup.ts --resume <runId> <approved|denied>
//
// Demo:
//   1. npx tsx scripts/run-standup.ts                        # pauses; note the printed run id
//   2. npx tsx scripts/run-standup.ts --resume <runId> denied   # nothing gets posted
//   3. npx tsx scripts/run-standup.ts                        # run again, get a new run id
//   4. npx tsx scripts/run-standup.ts --resume <runId> approved # now check Slack for the post

import { mastra } from '../src/mastra';

const [flag, runId, decision] = process.argv.slice(2);
const workflow = mastra.getWorkflow('standupWorkflow');

if (flag === '--resume') {
  if (!runId || !decision) {
    console.error('Usage: npx tsx scripts/run-standup.ts --resume <runId> <approved|denied>');
    process.exit(1);
  }
  const run = await workflow.createRun({ runId });
  const result = await run.resume({ resumeData: { approved: decision === 'approved' } });
  console.log(`status: ${result.status}\n`);
  if (result.status === 'success') {
    console.log(result.result.confirmation);
  }
  process.exit(0);
}

const run = await workflow.createRun();
const result = await run.start({
  inputData: { userId: process.env.TEST_USER_ID || 'demo-user', now: new Date().toISOString() },
});

console.log(`status: ${result.status}\n`);
if (result.status === 'suspended') {
  const suspendPayloadByStep = result.suspendPayload as Record<string, { summary: string }>;
  const suspendPayload = Object.values(suspendPayloadByStep)[0];
  console.log(`run id: ${run.runId}\n`);
  console.log(suspendPayload.summary);
  console.log('\nResume with:');
  console.log(`  npx tsx scripts/run-standup.ts --resume ${run.runId} approved`);
  console.log(`  npx tsx scripts/run-standup.ts --resume ${run.runId} denied`);
} else if (result.status === 'success') {
  console.log(result.result.summary);
}

import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';
import { JUDGE_MODEL } from '../config';

// Async eval scorer (Mastra Studio only) — separate from the synchronous
// reviewer-agent, which checks the full tool-call trace, not just conversation text.
const analyzeOutputSchema = z.object({
  // .default([]): the judge often omits the field rather than sending `[]`.
  ungroundedClaims: z.array(z.string()).default([]),
});

export const noFabricationScorer = createScorer({
  id: 'no-fabrication-scorer',
  name: 'No Fabrication Scorer',
  description: 'Flags factual claims in an agent response that are not supported by the conversation context',
  type: 'agent',
  judge: {
    model: JUDGE_MODEL,
    instructions: `You check whether an assistant's response contains any specific factual claim (a ticket ID, PR number, name, date, or status) that isn't supported by the conversation so far. Be strict: if a claim's origin can't be traced to something already said, list it.`,
  },
})
  .analyze({
    description: 'List any factual claims in the response not grounded in the conversation context',
    outputSchema: analyzeOutputSchema,
    createPrompt: ({ run }) => `Conversation (user messages / prior context):
${JSON.stringify(run.input, null, 2)}

Assistant response to check:
${JSON.stringify(run.output, null, 2)}

List every specific factual claim (ticket ID, PR number, name, date, status) in the response that is not grounded in the conversation context above. Return an empty list if none.`,
  })
  .generateScore(({ results }) => (results.analyzeStepResult?.ungroundedClaims?.length ? 0 : 1))
  .generateReason(({ results, score }) =>
    score === 1
      ? 'No ungrounded claims detected.'
      : `Ungrounded claims: ${results.analyzeStepResult?.ungroundedClaims?.join('; ')}`,
  );

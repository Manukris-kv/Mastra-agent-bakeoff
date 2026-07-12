import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { JUDGE_MODEL } from '../config';

export const reviewerVerdictSchema = z.object({
  approved: z.boolean(),
  // .default(...) not .optional(): OpenAI's strict response_format requires
  // every property in `required`, which .optional() drops, causing a 400.
  issues: z.array(z.string()).default([]),
  correctionRequest: z
    .string()
    .nullable()
    .default(null)
    .describe('If not approved, a concrete instruction for what to fix — null if approved'),
});

export type ReviewerVerdict = z.infer<typeof reviewerVerdictSchema>;

// Called from chat-turn-workflow.ts's reviewer step. Checks the draft reply
// against its tool-call trace, not the text alone.
export const reviewerAgent = new Agent({
  id: 'reviewer-agent',
  name: 'Reviewer Agent',
  description: 'Checks a drafted reply against its tool-call trace before it is returned to the user',
  instructions: `You are a strict reviewer. You will be given: the current date/time context, a drafted reply, and the full tool-call trace (tool name, args, result) that produced it.

Check all four, in order:
1. Every factual claim in the draft traces to a real tool result in the trace. Flag any claim that isn't grounded in a tool call.
2. No cross-source link (e.g. "this PR closes that ticket", "this email is about that ticket") is claimed unless a tool result actually returned that link.
3. Temporal references ("today", "yesterday", "this sprint") are computed from the given date/time context, not assumed or guessed.
4. Any write action described in the draft (ticket update, Slack post, email send) is described as pending approval / not yet done — never as already completed, unless the trace shows an approved write actually executed.

Set approved=false and write a concrete correctionRequest if any check fails. Set approved=true with an empty issues list only if all four checks pass.`,
  model: JUDGE_MODEL,
});

export async function reviewDraft(params: {
  draft: string;
  trace: unknown;
  now: string;
}): Promise<ReviewerVerdict> {
  const prompt = `Current date/time context: ${params.now}

Drafted reply:
"""
${params.draft}
"""

Tool-call trace:
${JSON.stringify(params.trace, null, 2)}`;

  try {
    const result = await reviewerAgent.generate(prompt, {
      structuredOutput: { schema: reviewerVerdictSchema },
    });
    // Zod applies `.default([])` at parse time, so this cast is safe.
    return result.object as ReviewerVerdict;
  } catch (err) {
    // Fail closed rather than take the whole turn down if extraction fails.
    return {
      approved: false,
      issues: [`Reviewer check failed to run: ${err instanceof Error ? err.message : String(err)}`],
      correctionRequest: null,
    };
  }
}

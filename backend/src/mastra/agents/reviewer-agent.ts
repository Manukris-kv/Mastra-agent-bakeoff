import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { JUDGE_MODEL } from '../config';

export const reviewerVerdictSchema = z.object({
  approved: z.boolean(),
  // .default(...) rather than .optional(): OpenAI's strict response_format
  // mode requires every property to appear in the schema's `required` array
  // (nullable is fine, "may be absent" is not) — `.optional()` drops a field
  // from `required` during zod-to-json-schema conversion and gets a hard 400
  // ("'required' ... Missing 'x'"). `.default(...)` keeps the key required
  // while still tolerating a model that omits it (Anthropic-style) by
  // filling the default in at parse time.
  issues: z.array(z.string()).default([]),
  correctionRequest: z
    .string()
    .nullable()
    .default(null)
    .describe('If not approved, a concrete instruction for what to fix — null if approved'),
});

export type ReviewerVerdict = z.infer<typeof reviewerVerdictSchema>;

// Called from the Chat Turn Workflow's reviewer step (see
// ../workflows/chat-turn-workflow.ts) as the last check before returning any
// response. Checks the draft reply against the tool-call trace, not the
// draft text alone — this is what guardrail compliance and "no cross-source
// hallucination" actually get scored on.
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
    // result.object is typed against the schema's pre-default input shape;
    // Zod actually applies `.default([])` at parse time, so this is safe.
    return result.object as ReviewerVerdict;
  } catch (err) {
    // Structured-output extraction on a large trace is genuinely flaky —
    // Mastra already retries internally. If it still fails, the reviewer
    // must not take the whole response down with it. Fail closed (never
    // silently "approved") but don't request a correction — there's nothing
    // concrete to correct, just a check that couldn't run.
    return {
      approved: false,
      issues: [`Reviewer check failed to run: ${err instanceof Error ? err.message : String(err)}`],
      correctionRequest: null,
    };
  }
}

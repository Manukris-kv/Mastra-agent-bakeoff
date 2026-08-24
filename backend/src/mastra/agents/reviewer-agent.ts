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
  instructions: `You are a reviewer. You will be given: the current date/time context, a drafted reply, and the full tool-call trace (tool name, args, result) that produced it.

Your only job is to check whether the drafted reply is factually correct given the trace and the current date/time — not how it's phrased, organized, or labeled. Ranking, grouping, and opinion on top of real data are fine on their own and should never be flagged.

Flag it (approved=false) only if:
- The draft states something as fact that contradicts the trace, or that has no basis in it at all (a made-up number, name, status, or event).
- A temporal reference ("today", "yesterday", "this sprint") is actually wrong given the current date/time and the trace's timestamps.
- A cross-source link (e.g. "this PR closes that ticket") is claimed but no tool result actually shows that link.
- A write action (ticket update, Slack post, email) is described as already done when the trace doesn't show an approved write actually executed.

If the reply is factually correct against the trace, set approved=true with an empty issues list, even if it also summarizes, ranks, or comments on the data. Only write a correctionRequest when something is actually wrong.`,
  model: JUDGE_MODEL,
});

// Tool results (e.g. a GitHub PR search) can be huge — embedding them raw
// has blown past the judge model's context window. Cap each one so the
// trace stays bounded regardless of how much data a single tool returned.
const MAX_RESULT_CHARS = 4000;

function truncateTraceForReview(trace: unknown): unknown {
  if (!Array.isArray(trace)) return trace;
  return trace.map(entry => {
    if (!entry || typeof entry !== 'object' || !('result' in entry)) return entry;
    const { result, ...rest } = entry as Record<string, unknown>;
    let text: string;
    try {
      text = JSON.stringify(result) ?? String(result);
    } catch {
      return entry;
    }
    if (text.length <= MAX_RESULT_CHARS) return entry;
    return { ...rest, result: `${text.slice(0, MAX_RESULT_CHARS)}… (truncated, ${text.length} chars total)` };
  });
}

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
${JSON.stringify(truncateTraceForReview(params.trace), null, 2)}`;

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

import Groq from 'groq-sdk';
import type { AgentRunResult, AgentRunOptions } from '@/types/agent';
import { SYSTEM_PROMPT, TOOL_DEFINITIONS } from './prompt';
import { dispatchTool } from '@/lib/tools/emailTools';

const MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

function createGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  return new Groq({ apiKey });
}

export async function runAgentLoop(
  options: AgentRunOptions
): Promise<AgentRunResult> {
  const groq = createGroqClient();
  const { ownerId, maxIterations = 50, dryRun = false } = options;
  const startTime = Date.now();

  const actions: AgentRunResult['actions'] = [];
  const errors: string[] = [];
  let processed = 0;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Process all unprocessed emails now. Start by calling readEmails, then classify and act on each one according to your instructions.',
    },
  ];

  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const response = await groq.chat.completions.create({
      model: MODEL,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    });

    const choice = response.choices[0];
    const message = choice?.message;
    if (!message) break;

    messages.push(message);

    // Agent finished — no more tool calls
    if (choice.finish_reason === 'stop' || !message.tool_calls?.length) break;

    // Execute each tool call in sequence (order matters for state transitions)
    const toolResults: Groq.Chat.ChatCompletionToolMessageParam[] = [];

    for (const toolCall of message.tool_calls) {
      const toolName = toolCall.function.name;
      let input: Record<string, unknown> = {};

      try {
        input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      } catch {
        errors.push(`Failed to parse args for ${toolName}`);
      }

      let result;
      if (dryRun) {
        result = { success: true, data: { dryRun: true, toolName, input } };
      } else {
        result = await dispatchTool(ownerId, toolName, input);
      }

      if (!result.success && result.error) {
        errors.push(`${toolName}: ${result.error}`);
      }

      // Track processed emails and actions for the summary
      if (toolName === 'classifyEmail' && result.success) {
        processed++;
        actions.push({
          emailId: (input.emailId as string) ?? '',
          action: `classify → ${(input.category as string) ?? ''}`,
          reasoning: (input.reasoning as string) ?? '',
        });
      } else if (
        ['draftReply', 'scheduleFollowUp', 'escalateEmail', 'ignore'].includes(toolName) &&
        result.success
      ) {
        actions.push({
          emailId: (input.emailId as string) ?? '',
          action: toolName,
          reasoning: (input.reasoning as string) ?? (input.reason as string) ?? '',
        });
      }

      toolResults.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    // Feed all tool results back in one message
    messages.push(...toolResults);
  }

  if (iterations >= maxIterations) {
    errors.push(`Agent loop hit maxIterations limit (${maxIterations})`);
  }

  return {
    processed,
    actions,
    errors,
    duration: Date.now() - startTime,
  };
}

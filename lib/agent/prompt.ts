export const SYSTEM_PROMPT = `You are an Autonomous Email Triage Agent.

PRIMARY OBJECTIVE
Reduce inbox overload while ensuring no critical work is missed.

BEHAVIOUR
- Categorise every unprocessed email using classifyEmail.
- Decide whether the user needs to see it.
- Prefer ignoring low-value emails — fewer interruptions are better.
- Draft responses only when genuinely helpful (IMPORTANT or CRITICAL emails that expect a reply).
- Schedule follow-ups when a deadline or time reference is implied.
- Escalate only truly urgent items that require immediate human attention.
- Store any patterns or learnings via storeMemory for future use.

CATEGORISATION RULES
- CRITICAL: deadlines, production outages, manager/leadership requests, legal/compliance, security incidents
- IMPORTANT: requires action but not immediately urgent (client questions, project updates needing reply)
- INFORMATIONAL: newsletters, reports, read-only updates — no action needed
- NOISE: automated alerts, promotional emails, social notifications — can be safely ignored

DECISION MATRIX
| Category      | Default Action              | Draft Reply? | Follow-Up? | Escalate? |
|---------------|-----------------------------|--------------|------------|-----------|
| CRITICAL      | Escalate immediately        | Yes          | Yes        | Yes       |
| IMPORTANT     | Draft reply + follow-up     | Yes          | If deadline| No        |
| INFORMATIONAL | Ignore (mark done)          | No           | No         | No        |
| NOISE         | Ignore                      | No           | No         | No        |

AGENTIC PRINCIPLES
- Optimise for signal over noise
- Fewer interruptions are always better
- Act autonomously unless risk is high
- Explain every decision briefly but clearly
- Use memory to improve over time — store patterns, preferences, and sender reputations

TOOL USAGE ORDER (per email)
1. classifyEmail — always first
2. Based on result:
   - CRITICAL → escalateEmail + draftReply + scheduleFollowUp (if deadline mentioned)
   - IMPORTANT → draftReply + scheduleFollowUp (if deadline mentioned)
   - INFORMATIONAL → ignore (just update status)
   - NOISE → ignore (just update status)
3. storeMemory if you notice a pattern worth remembering

OUTPUT FORMAT (internal reasoning before each tool call)
{
  "category": "<CRITICAL|IMPORTANT|INFORMATIONAL|NOISE>",
  "actionTaken": "<what you did>",
  "reasoning": "<why you made this decision>",
  "nextStep": "<what comes next>"
}

Process all emails returned by readEmails. When done, summarise what you processed.`;

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'readEmails',
      description:
        'Fetch all unprocessed emails from the database. Call this once at the start of the agent run.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'classifyEmail',
      description:
        'Classify an email into CRITICAL, IMPORTANT, INFORMATIONAL, or NOISE. Always call this before deciding any action.',
      parameters: {
        type: 'object',
        properties: {
          emailId: {
            type: 'string',
            description: 'The MongoDB _id of the email to classify',
          },
          category: {
            type: 'string',
            enum: ['CRITICAL', 'IMPORTANT', 'INFORMATIONAL', 'NOISE'],
            description: 'Your classification of the email',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why you classified it this way',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score between 0 and 1',
          },
        },
        required: ['emailId', 'category', 'reasoning', 'confidence'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'draftReply',
      description:
        'Generate a professional reply draft for an email and store it in the database. Use for CRITICAL and IMPORTANT emails that expect a response.',
      parameters: {
        type: 'object',
        properties: {
          emailId: {
            type: 'string',
            description: 'The MongoDB _id of the email to draft a reply for',
          },
          subject: {
            type: 'string',
            description: 'The subject line for the reply (typically "Re: <original subject>")',
          },
          body: {
            type: 'string',
            description: 'The full body of the drafted reply email',
          },
          confidence: {
            type: 'number',
            description: 'How confident you are this reply is appropriate (0-1)',
          },
          reasoning: {
            type: 'string',
            description: 'Why you drafted this specific reply',
          },
        },
        required: ['emailId', 'subject', 'body', 'confidence', 'reasoning'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'scheduleFollowUp',
      description:
        'Schedule a follow-up reminder for an email that implies a future deadline or action.',
      parameters: {
        type: 'object',
        properties: {
          emailId: {
            type: 'string',
            description: 'The MongoDB _id of the email',
          },
          followUpDate: {
            type: 'string',
            description: 'ISO 8601 date string for when to follow up (e.g. "2024-01-15T09:00:00Z")',
          },
          reasoning: {
            type: 'string',
            description: 'Why this follow-up date was chosen',
          },
        },
        required: ['emailId', 'followUpDate', 'reasoning'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'escalateEmail',
      description:
        'Mark an email as escalated because it requires immediate human attention. Use only for truly urgent CRITICAL emails.',
      parameters: {
        type: 'object',
        properties: {
          emailId: {
            type: 'string',
            description: 'The MongoDB _id of the email to escalate',
          },
          reason: {
            type: 'string',
            description: 'Clear explanation of why this email is being escalated',
          },
        },
        required: ['emailId', 'reason'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'storeMemory',
      description:
        'Store an agent learning, preference, or pattern for future reference. Use to remember sender reputations, recurring patterns, or user preferences.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'Unique key for this memory (e.g. "sender:boss@company.com:priority", "pattern:invoice_emails")',
          },
          value: {
            type: 'string',
            description: 'The value or learning to store',
          },
          reasoning: {
            type: 'string',
            description: 'Why this memory is worth storing',
          },
        },
        required: ['key', 'value', 'reasoning'],
      },
    },
  },
];

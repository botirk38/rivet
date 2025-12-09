import { CursorAgent } from "@cursor-ai/january";
import { loadConfig } from "./config";
import type { AnalysisContext, AnalysisMode, TextMessage, ConversationTurn } from "./types";

// Initialize agent
export async function createAgent() {
  const config = await loadConfig();
  const apiKey = process.env.CURSOR_API_KEY || config?.apiKey;

  if (!apiKey) {
    console.error("Error: CURSOR_API_KEY not found");
    console.log("\nSet it with: export CURSOR_API_KEY=your_key");
    console.log("Or run: rivet init");
    process.exit(1);
  }

  const model = process.env.RIVET_MODEL || config?.model || "auto";

  return new CursorAgent({
    apiKey,
    model,
    workingLocation: {
      type: "local",
      localDirectory: process.cwd(),
    },
  });
}

// Helper to suppress stderr during async operations
export async function withSuppressedStderr<T>(fn: () => Promise<T>): Promise<T> {
  const originalStderr = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return await fn();
  } finally {
    process.stderr.write = originalStderr;
  }
}

// Analysis helper (Turn 1)
export async function analyzeChanges(
  context: AnalysisContext,
  mode: AnalysisMode
): Promise<string> {
  const agent = await createAgent();

  let prompt: string;
  if (mode === "commit") {
    prompt = `Analyze these staged git changes and provide a concise summary.

Branch: ${context.branch}
Files changed: ${context.files.length}
${context.files.map(f => `• ${f}`).join('\n')}

Git diff:
${context.diff}

Summarize:
1. What type of change is this (feature, fix, refactor, docs, test, etc.)
2. What is the main purpose of these changes
3. Any notable implementation details

Keep your summary concise (2-4 sentences).`;
  } else {
    // PR mode
    prompt = `Analyze these branch changes for a pull request.

Branch: ${context.branch}
Files changed: ${context.files.length}
Commits:
${context.commits}

Git diff:
${context.diff}

Provide a detailed analysis:
1. What type of changes (feature, fix, refactor, etc.)
2. The overall story/purpose of this branch
3. Key implementation details
4. Any breaking changes or important notes
5. Suggested labels (bug, feature, enhancement, docs, etc.)

Keep analysis clear and comprehensive.`;
  }

  let summary = "";
  const result = agent.submit({
    message: prompt,
    onStep: ({ step }) => {
      if (step.type === "assistantMessage") {
        const msg = step.message as TextMessage;
        if (msg?.text) {
          summary = msg.text.trim();
        }
      }
    }
  });

  await withSuppressedStderr(async () => {
    await result.conversation;
  });

  if (!summary) {
    throw new Error("Failed to get analysis from agent");
  }

  return summary;
}

// Extract the last assistant message from a conversation using functional style
export function extractLastAssistantMessage(conversation: ConversationTurn[]): string | null {
  return [...conversation]
    .reverse()
    .flatMap(turn =>
      turn.type === "agentConversationTurn" && turn.turn?.steps
        ? [...turn.turn.steps].reverse()
        : []
    )
    .filter(step => step?.type === "assistantMessage" && step.message?.text)
    .map(step => step.message?.text?.trim() ?? "")
    .find(text => text.length > 0) ?? null;
}
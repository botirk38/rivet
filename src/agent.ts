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
    prompt = `Analyze these staged git changes for a commit message.

Files changed (${context.stats.length}):
${context.stats.map(f => `• ${f.file} (+${f.insertions}/-${f.deletions})`).join('\n')}

Use grep/read tools to examine the actual changes. Summarize in 2-3 sentences:
1. Type of change (feat/fix/refactor/docs/test)
2. Main purpose
3. Key details`;
  } else {
    // PR mode
    prompt = `Analyze these branch changes for a pull request.

Branch: ${context.branch}
Files changed (${context.stats.length}):
${context.stats.map(f => `• ${f.file} (+${f.insertions}/-${f.deletions})`).join('\n')}

Commits:
${context.commits}

${context.prTemplate ? `PR Template:\n${context.prTemplate}\n\n` : ''}Use grep/read tools to examine the actual changes. Provide detailed analysis:
1. Type of changes (feat/fix/refactor/docs/test)
2. Overall purpose of this branch
3. Key implementation details
4. Any breaking changes or important notes`;
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

  // Suppress SDK debug logs by redirecting stderr during conversation wait
  const originalStderr = process.stderr.write;
  process.stderr.write = () => true;
  await result.conversation;
  process.stderr.write = originalStderr;

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
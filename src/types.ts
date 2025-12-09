export type CommitStyle = "conventional" | "angular" | "simple" | "emoji";

export interface RivetConfig {
  apiKey?: string;
  model?: string;
  defaultBaseBranch?: string;
  commitStyle?: CommitStyle;
  commitSystemPrompt?: string;
  prSystemPrompt?: string;
}

// Prompt result types
export type ConfirmPromptResult = { accept: boolean };
export type FeedbackPromptResult = { feedback: string };
export type OverwritePromptResult = { overwrite: boolean };
export type ApiKeyPromptResult = { apiKey: string };
export type ModelPromptResult = { model: string };
export type BaseBranchPromptResult = { defaultBaseBranch: string };
export type CommitStylePromptResult = { commitStyle: CommitStyle };
export type CommitSystemPromptResult = { commitSystemPrompt: string };
export type PrSystemPromptResult = { prSystemPrompt: string };
export type PushPromptResult = { push: boolean };
export type CommitFirstPromptResult = { commitFirst: boolean };

// Agent message types
export type TextMessage = { text?: string };

// Analysis types
export type AnalysisMode = "commit" | "pr";

export type AnalysisContext = {
  diff: string;
  branch: string;
  files: string[];
  commits?: string;  // Only for PR
  prTemplate?: string;  // Only for PR, if exists
};

// Type definitions for conversation parsing
export type ConversationTurn = {
  type: string;
  turn?: {
    steps?: Array<{
      type: string;
      message?: { text?: string };
    }>;
  };
};

// REPL loop for interactive refinement
export interface ReplOptions<T> {
  display: (value: T) => void;
  regenerate: (feedback: string) => Promise<T | null>;
  spinnerText: string;
  confirmMessage: string;
}

// PR data type
export interface PrData {
  title: string;
  body: string;
  labels?: string[];
}
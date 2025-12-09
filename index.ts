#!/usr/bin/env bun

import { Command } from "commander";
import { CursorAgent } from "@cursor-ai/january";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { join } from "path";

// Config file path
const CONFIG_FILE = "rivet.config.json";

type CommitStyle = "conventional" | "angular" | "simple" | "emoji";

interface RivetConfig {
  apiKey?: string;
  model?: string;
  defaultBaseBranch?: string;
  commitStyle?: CommitStyle;
  commitSystemPrompt?: string;
  prSystemPrompt?: string;
}

// Load config from file
async function loadConfig(): Promise<RivetConfig | null> {
  const configPath = join(process.cwd(), CONFIG_FILE);
  
  try {
    const file = Bun.file(configPath);
    if (!(await file.exists())) {
      return null;
    }
    const content = await file.text();
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Save config to file
async function saveConfig(config: RivetConfig): Promise<void> {
  const configPath = join(process.cwd(), CONFIG_FILE);
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}

const program = new Command();

// Git helper functions
async function getStagedDiff(): Promise<string> {
  const result = await Bun.$`git diff --cached`.quiet();
  return result.stdout.toString();
}

async function getStagedFiles(): Promise<string[]> {
  try {
    const result = await Bun.$`git diff --cached --name-only`.quiet();
    return result.stdout.toString().trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function getCurrentBranch(): Promise<string> {
  const result = await Bun.$`git branch --show-current`.quiet();
  return result.stdout.toString().trim();
}

async function getBranchDiff(baseBranch: string): Promise<string> {
  const result = await Bun.$`git diff ${baseBranch}...HEAD`.quiet();
  return result.stdout.toString();
}

async function getBranchCommits(baseBranch: string): Promise<string> {
  const result = await Bun.$`git log ${baseBranch}..HEAD --oneline`.quiet();
  return result.stdout.toString();
}

async function getChangedFilesCount(baseBranch: string): Promise<number> {
  try {
    const result = await Bun.$`git diff --name-only ${baseBranch}...HEAD`.quiet();
    const files = result.stdout.toString().trim().split("\n").filter(Boolean);
    return files.length;
  } catch {
    return 0;
  }
}

async function createCommit(message: string, noVerify = false): Promise<void> {
  const flags = noVerify ? ["--no-verify"] : [];
  await Bun.$`git commit -m ${message} ${flags}`;
}

async function getBaseBranch(): Promise<string> {
  // Try main first, then master
  try {
    await Bun.$`git show-ref --verify --quiet refs/heads/main`.quiet();
    return "main";
  } catch {
    return "master";
  }
}

// Initialize agent
async function createAgent() {
  const config = await loadConfig();
  const apiKey = process.env.CURSOR_API_KEY || config?.apiKey;
  
  if (!apiKey) {
    console.error(chalk.red("Error: CURSOR_API_KEY not found"));
    console.log(chalk.gray("\nSet it with: export CURSOR_API_KEY=your_key"));
    console.log(chalk.gray("Or run: rivet init"));
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

// Helper to format commit message for display
function formatCommitMessage(message: string): string {
  const lines = message.split("\n");
  const subject = lines[0];
  const body = lines.slice(1).join("\n").trim();
  
  let formatted = chalk.bold.cyan(subject);
  if (body) {
    formatted += "\n\n" + chalk.gray(body);
  }
  return formatted;
}

// Type definitions for conversation parsing
type ConversationTurn = {
  type: string;
  turn?: {
    steps?: Array<{
      type: string;
      message?: { text?: string };
    }>;
  };
};

// Commit style prompts
const COMMIT_STYLE_PROMPTS: Record<CommitStyle, string> = {
  conventional: "Use conventional commit format: type(scope): subject. Examples: feat(auth): add OAuth login, fix(ui): resolve button alignment, docs(readme): update installation instructions.",
  angular: "Use Angular commit format with detailed body. Include type(scope): subject line, then detailed body explaining what changed and why. Include breaking changes section if applicable.",
  simple: "Write a clear, concise one-line commit message that describes what changed and why.",
  emoji: "Use gitmoji format: 🎉 type: subject. Examples: ✨ feat: add OAuth login, 🐛 fix: resolve button alignment, 📚 docs: update installation instructions."
};

// Extract the last assistant message from a conversation using functional style
function extractLastAssistantMessage(conversation: ConversationTurn[]): string | null {
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

// REPL loop for interactive refinement
interface ReplOptions<T> {
  display: (value: T) => void;
  regenerate: (feedback: string) => Promise<T | null>;
  spinnerText: string;
  confirmMessage: string;
}

async function replLoop<T>(
  initialValue: T,
  options: ReplOptions<T>,
  skipConfirmation: boolean
): Promise<{ accepted: boolean; value: T }> {
  let currentValue = initialValue;

  while (true) {
    options.display(currentValue);

    if (skipConfirmation) {
      return { accepted: true, value: currentValue };
    }

    const { accept } = await inquirer.prompt<{ accept: boolean }>([
      {
        type: "confirm",
        name: "accept",
        message: options.confirmMessage,
        default: true,
      },
    ]);

    if (accept) {
      return { accepted: true, value: currentValue };
    }

    // User said no - get feedback
    const { feedback } = await inquirer.prompt<{ feedback: string }>([
      {
        type: "input",
        name: "feedback",
        message: "How should it be improved?",
      },
    ]);

    // Empty feedback = cancel
    if (!feedback.trim()) {
      return { accepted: false, value: currentValue };
    }

    const spinner = ora(chalk.blue(options.spinnerText)).start();
    const newValue = await options.regenerate(feedback);

    if (newValue !== null) {
      currentValue = newValue;
      spinner.succeed(chalk.green("Regenerated"));
    } else {
      spinner.fail(chalk.red("Failed to regenerate"));
    }
  }
}

// Commit command
async function commitCommand(options: { "no-verify"?: boolean; yes?: boolean }) {
  try {
    // Check if we're in a git repo
    const repoSpinner = ora("Checking git repository...").start();
    try {
      await Bun.$`git rev-parse --git-dir`.quiet();
      repoSpinner.succeed(chalk.green("Git repository found"));
    } catch {
      repoSpinner.fail(chalk.red("Not in a git repository"));
      throw new Error("Not in a git repository");
    }

    // Check git status first to see if there are any changes
    const statusResult = await Bun.$`git status --porcelain`.quiet();
    const statusOutput = statusResult.stdout.toString().trim();
    
    if (!statusOutput) {
      console.log(chalk.yellow("\nTip: Make some changes to your files first, then run this command again."));
      throw new Error("No changes to commit");
    }

    // Always stage all changes automatically (including new files)
    const stageSpinner = ora("Staging all changes...").start();
    await Bun.$`git add .`.quiet();
    
    // Get staged files count
    const stagedFiles = await getStagedFiles();
    if (stagedFiles.length > 0) {
      stageSpinner.succeed(chalk.green(`Staged ${stagedFiles.length} file(s)`));
    } else {
      stageSpinner.succeed(chalk.green("Changes staged"));
    }

    // Verify we have staged changes (check both diff and status)
    const diff = await getStagedDiff();
    const stagedStatus = await Bun.$`git status --porcelain`.quiet();
    const hasStagedChanges = stagedStatus.stdout.toString().trim().split("\n").some(line => {
      const status = line.substring(0, 2);
      return status.includes("A") || status.includes("M") || status.includes("D");
    });
    
    if (!diff.trim() && !hasStagedChanges) {
      throw new Error("No changes to commit");
    }

    const branch = await getCurrentBranch();
    const files = await getStagedFiles();

    // Show summary
    console.log(chalk.blue("\nSummary:"));
    console.log(chalk.gray(`   Branch: ${chalk.white(branch)}`));
    console.log(chalk.gray(`   Files: ${chalk.white(files.length)} file(s) changed`));
    if (files.length <= 10) {
      files.forEach(file => {
        console.log(chalk.gray(`   • ${file}`));
      });
    } else {
      files.slice(0, 5).forEach(file => {
        console.log(chalk.gray(`   • ${file}`));
      });
      console.log(chalk.gray(`   ... and ${files.length - 5} more`));
    }

    // Generate commit message
    const generateSpinner = ora(chalk.blue("Generating commit message...")).start();

    const agent = await createAgent();
    const config = await loadConfig();

    // Build prompt with style and system instructions
    const stylePrompt = config?.commitStyle
      ? COMMIT_STYLE_PROMPTS[config.commitStyle]
      : "Create a clear, descriptive commit message.";

    const systemPrompt = config?.commitSystemPrompt
      ? `\n\n${config.commitSystemPrompt}`
      : "";

    const prompt = `${stylePrompt}${systemPrompt}

Analyze these git changes and create a commit message.

Branch: ${branch}

Git diff:
${diff}

Return ONLY a commit message.`;

    let commitMessage = "";

    const result = agent.submit({ 
      message: prompt,
      onDelta: ({ update }) => {
        if (update.type === "text-delta") {
          generateSpinner.text = chalk.blue("Generating commit message...");
        }
      },
      onStep: ({ step }) => {
        if (step.type === "assistantMessage") {
          const msg = step.message as { text?: string };
          if (msg?.text) {
            commitMessage = msg.text.trim();
          }
        }
      }
    });
    
    const conversation = await result.conversation;
    
    // If onStep didn't capture, fall back to scanning conversation (functional style)
    if (!commitMessage) {
      commitMessage = extractLastAssistantMessage(conversation as ConversationTurn[]) ?? "";
    }
    
    if (!commitMessage) {
      generateSpinner.fail(chalk.red("Failed to extract commit message from agent response"));
      const debugInfo = conversation.map(t => ({ 
        type: (t as ConversationTurn)?.type, 
        stepsCount: (t as ConversationTurn)?.type === "agentConversationTurn" 
          ? (t as ConversationTurn).turn?.steps?.length 
          : 0 
      }));
      console.error(chalk.gray("\nDebug: Conversation structure:"), JSON.stringify(debugInfo, null, 2));
      throw new Error("Failed to extract commit message from agent response");
    }

    generateSpinner.succeed(chalk.green("Commit message generated"));

    // Helper to generate message with agent
    const generateMessage = async (prompt: string): Promise<string | null> => {
      let message = "";
      const genResult = agent.submit({
        message: prompt,
        onStep: ({ step }) => {
          if (step.type === "assistantMessage") {
            const msg = step.message as { text?: string };
            if (msg?.text) message = msg.text.trim();
          }
        }
      });
      const convo = await genResult.conversation;
      return message || extractLastAssistantMessage(convo as ConversationTurn[]);
    };

    // REPL loop for refinement
    const { accepted, value: finalMessage } = await replLoop(
      commitMessage,
      {
        display: (msg) => {
          console.log(chalk.blue("\nGenerated commit message:"));
          console.log(chalk.gray("─".repeat(60)));
          console.log(formatCommitMessage(msg));
          console.log(chalk.gray("─".repeat(60)));
        },
        regenerate: async (feedback) => {
          const prompt = `The previous commit message was:
${commitMessage}

The user wants this improvement: ${feedback}

Generate an improved commit message based on this feedback. Return ONLY the commit message.`;
          return generateMessage(prompt);
        },
        spinnerText: "Regenerating commit message...",
        confirmMessage: "Accept this commit message?",
      },
      options.yes ?? false
    );

    if (!accepted) {
      console.log(chalk.yellow("Cancelled. No commit created."));
      return;
    }

    // Create commit
    const commitSpinner = ora("Creating commit...").start();
    await createCommit(finalMessage, options["no-verify"]);
    commitSpinner.succeed(chalk.green("Commit created successfully!"));
    
    console.log(chalk.green("\nDone!"));
  } catch (error) {
    console.error(chalk.red("\nError:"), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Raise PR command
async function raisePRCommand(options: { base?: string; draft?: boolean; yes?: boolean }) {
  try {
    // Check if we're in a git repo
    const repoSpinner = ora("Checking git repository...").start();
    try {
      await Bun.$`git rev-parse --git-dir`.quiet();
      repoSpinner.succeed(chalk.green("Git repository found"));
    } catch {
      repoSpinner.fail(chalk.red("Not in a git repository"));
      throw new Error("Not in a git repository");
    }

    // Check if gh CLI is installed
    const ghSpinner = ora("Checking GitHub CLI...").start();
    try {
      await Bun.$`gh --version`.quiet();
      ghSpinner.succeed(chalk.green("GitHub CLI found"));
    } catch {
      ghSpinner.fail(chalk.red("GitHub CLI (gh) is not installed"));
      console.log(chalk.gray("\nInstall it from: https://cli.github.com/"));
      throw new Error("GitHub CLI (gh) is not installed");
    }

    const currentBranch = await getCurrentBranch();
    const config = await loadConfig();
    const baseBranch = options.base || config?.defaultBaseBranch || await getBaseBranch();

    // Analyze changes
    const analyzeSpinner = ora(`Analyzing changes from ${chalk.white(baseBranch)} to ${chalk.white(currentBranch)}...`).start();
    const diff = await getBranchDiff(baseBranch);
    const commits = await getBranchCommits(baseBranch);
    const filesCount = await getChangedFilesCount(baseBranch);
    const commitsList = commits.trim().split("\n").filter(Boolean);

    if (!diff.trim() && !commits.trim()) {
      analyzeSpinner.fail(chalk.red(`No changes found between ${baseBranch} and ${currentBranch}`));
      throw new Error(`No changes found between ${baseBranch} and ${currentBranch}`);
    }

    analyzeSpinner.succeed(chalk.green(`Found ${filesCount} file(s) changed, ${commitsList.length} commit(s)`));

    // Show summary
    console.log(chalk.blue("\nSummary:"));
    console.log(chalk.gray(`   Branch: ${chalk.white(currentBranch)} → ${chalk.white(baseBranch)}`));
    console.log(chalk.gray(`   Files: ${chalk.white(filesCount)} file(s) changed`));
    console.log(chalk.gray(`   Commits: ${chalk.white(commitsList.length)} commit(s)`));
    if (commitsList.length > 0 && commitsList.length <= 5) {
      commitsList.forEach(commit => {
        console.log(chalk.gray(`   • ${commit}`));
      });
    } else if (commitsList.length > 5) {
      commitsList.slice(0, 3).forEach(commit => {
        console.log(chalk.gray(`   • ${commit}`));
      });
      console.log(chalk.gray(`   ... and ${commitsList.length - 3} more`));
    }

    // Generate PR content
    const generateSpinner = ora(chalk.blue("Generating PR content...")).start();

    const agent = await createAgent();
    const prConfig = await loadConfig();

    // Build prompt with system instructions
    const systemPrompt = prConfig?.prSystemPrompt
      ? `${prConfig.prSystemPrompt}\n\n`
      : "";

    const prompt = `${systemPrompt}Create a GitHub PR for these changes.

Branch: ${currentBranch}
Base branch: ${baseBranch}

Commits:
${commits}

Git diff:
${diff}

Return ONLY valid JSON in this exact format:
{
  "title": "PR title here",
  "body": "PR description here. Explain what changed and why.",
  "labels": ["label1", "label2"]
}

Use appropriate labels like: bug, feature, enhancement, documentation, refactor, etc.`;

    let responseText = "";

    const result = agent.submit({ 
      message: prompt,
      onDelta: ({ update }) => {
        if (update.type === "text-delta") {
          generateSpinner.text = chalk.blue("Generating PR content...");
        }
      },
      onStep: ({ step }) => {
        if (step.type === "assistantMessage") {
          const msg = step.message as { text?: string };
          if (msg?.text) {
            responseText = msg.text.trim();
          }
        }
      }
    });
    
    const conversation = await result.conversation;
    
    // If onStep didn't capture, fall back to scanning conversation (functional style)
    if (!responseText) {
      responseText = extractLastAssistantMessage(conversation as ConversationTurn[]) ?? "";
    }
    
    if (!responseText) {
      generateSpinner.fail(chalk.red("Failed to extract PR content from agent response"));
      const debugInfo = conversation.map(t => ({ 
        type: (t as ConversationTurn)?.type, 
        stepsCount: (t as ConversationTurn)?.type === "agentConversationTurn" 
          ? (t as ConversationTurn).turn?.steps?.length 
          : 0 
      }));
      console.error(chalk.gray("\nDebug: Conversation structure:"), JSON.stringify(debugInfo, null, 2));
      throw new Error("Failed to extract PR content from agent response");
    }
    
    // Extract JSON from response (handle markdown code blocks)
    const extractJson = (text: string): string => {
      const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (codeBlockMatch?.[1]) return codeBlockMatch[1];
      
      const directMatch = text.match(/\{[\s\S]*\}/);
      return directMatch?.[0] ?? text;
    };

    const jsonText = extractJson(responseText);

    let prData;
    try {
      prData = JSON.parse(jsonText);
    } catch (error) {
      generateSpinner.fail(chalk.red("Failed to parse agent response as JSON"));
      throw new Error("Failed to parse agent response as JSON");
    }

    if (!prData.title || !prData.body) {
      generateSpinner.fail(chalk.red("Agent response missing title or body"));
      throw new Error("Agent response missing title or body");
    }

    generateSpinner.succeed(chalk.green("PR content generated"));

    // Type for PR data
    interface PrData {
      title: string;
      body: string;
      labels?: string[];
    }

    // Helper to generate PR content with agent
    const generatePrContent = async (prompt: string): Promise<PrData | null> => {
      let text = "";
      const genResult = agent.submit({
        message: prompt,
        onStep: ({ step }) => {
          if (step.type === "assistantMessage") {
            const msg = step.message as { text?: string };
            if (msg?.text) text = msg.text.trim();
          }
        }
      });
      const convo = await genResult.conversation;
      const responseText = text || extractLastAssistantMessage(convo as ConversationTurn[]);
      if (!responseText) return null;
      
      try {
        const jsonText = extractJson(responseText);
        const parsed = JSON.parse(jsonText);
        if (!parsed.title || !parsed.body) return null;
        return parsed as PrData;
      } catch {
        return null;
      }
    };

    // Display function for PR
    const displayPr = (data: PrData) => {
      console.log(chalk.blue("\nGenerated PR:"));
      console.log(chalk.gray("─".repeat(60)));
      console.log(chalk.bold.white("Title:"), data.title);
      console.log(chalk.gray("─".repeat(60)));
      const labelDisplay = data.labels?.length 
        ? data.labels.map(l => chalk.cyan(`"${l}"`)).join(", ")
        : chalk.gray("none");
      console.log(chalk.bold.white("Labels:"), labelDisplay);
      console.log(chalk.gray("─".repeat(60)));
      console.log(chalk.bold.white("Description:"));
      console.log(chalk.gray(data.body));
      console.log(chalk.gray("─".repeat(60)));
    };

    // REPL loop for refinement
    const { accepted, value: finalPrData } = await replLoop<PrData>(
      prData,
      {
        display: displayPr,
        regenerate: async (feedback) => {
          const prompt = `The previous PR content was:
Title: ${prData.title}
Body: ${prData.body}
Labels: ${prData.labels?.join(", ") ?? "none"}

The user wants this improvement: ${feedback}

Generate improved PR content based on this feedback. Return ONLY valid JSON in this exact format:
{
  "title": "PR title here",
  "body": "PR description here",
  "labels": ["label1", "label2"]
}`;
          return generatePrContent(prompt);
        },
        spinnerText: "Regenerating PR content...",
        confirmMessage: "Accept this PR content?",
      },
      options.yes ?? false
    );

    if (!accepted) {
      console.log(chalk.yellow("Cancelled. No PR created."));
      return;
    }

    // Create PR using gh CLI
    const createSpinner = ora("Creating PR on GitHub...").start();
    const draftFlag = options.draft ? ["--draft"] : [];
    const labels = finalPrData.labels?.length 
      ? ["--label", finalPrData.labels.join(",")]
      : [];

    try {
      const prResult = await Bun.$`gh pr create --title ${finalPrData.title} --body ${finalPrData.body} --base ${baseBranch} ${draftFlag} ${labels}`.quiet();
      const prUrl = prResult.stdout.toString().trim();
      createSpinner.succeed(chalk.green("PR created successfully!"));
      console.log(chalk.green("\nPR created:"), chalk.cyan.underline(prUrl));
    } catch (error) {
      createSpinner.fail(chalk.red("Failed to create PR"));
      throw error;
    }
  } catch (error) {
    console.error(chalk.red("\nError:"), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Init command
async function initCommand() {
  try {
    console.log(chalk.blue("Rivet Configuration\n"));

    const config: RivetConfig = {};
    const existingConfig = await loadConfig();

    // Check if config already exists
    if (existingConfig) {
      const { overwrite } = await inquirer.prompt([
        {
          type: "confirm",
          name: "overwrite",
          message: "Configuration file already exists. Overwrite?",
          default: false,
        },
      ]);

      if (!overwrite) {
        console.log(chalk.yellow("\nCancelled."));
        return;
      }
    }

    // Prompt for API key
    const { apiKey } = await inquirer.prompt([
      {
        type: "input",
        name: "apiKey",
        message: "Cursor API Key:",
        default: existingConfig?.apiKey || process.env.CURSOR_API_KEY || "",
        validate: (input) => {
          if (!input && !process.env.CURSOR_API_KEY) {
            return "API key is required (or set CURSOR_API_KEY env var)";
          }
          return true;
        },
      },
    ]);

    if (apiKey) {
      config.apiKey = apiKey;
    }

    // Prompt for model
    const { model } = await inquirer.prompt([
      {
        type: "list",
        name: "model",
        message: "Default model:",
        choices: [
          { name: "auto (recommended for free users)", value: "auto" },
          { name: "gpt-4o (premium)", value: "gpt-4o" },
          { name: "gpt-4.1 (free)", value: "gpt-4.1" },
        ],
        default: existingConfig?.model || "auto",
      },
    ]);
    config.model = model;

    // Prompt for default base branch
    const currentBase = await getBaseBranch().catch(() => "main");
    const { defaultBaseBranch } = await inquirer.prompt([
      {
        type: "input",
        name: "defaultBaseBranch",
        message: "Default base branch for PRs:",
        default: existingConfig?.defaultBaseBranch || currentBase,
      },
    ]);
    config.defaultBaseBranch = defaultBaseBranch;

    // Prompt for commit style
    const { commitStyle } = await inquirer.prompt([
      {
        type: "list",
        name: "commitStyle",
        message: "Default commit message style:",
        choices: [
          { name: "conventional - feat(scope): subject", value: "conventional" },
          { name: "angular - detailed body format", value: "angular" },
          { name: "simple - clear one-line message", value: "simple" },
          { name: "emoji - 🎉 type: subject", value: "emoji" },
        ],
        default: existingConfig?.commitStyle || "conventional",
      },
    ]);
    config.commitStyle = commitStyle;

    // Prompt for commit system prompt
    const { commitSystemPrompt } = await inquirer.prompt([
      {
        type: "input",
        name: "commitSystemPrompt",
        message: "Custom commit instructions (optional):",
        default: existingConfig?.commitSystemPrompt || "",
      },
    ]);
    if (commitSystemPrompt.trim()) {
      config.commitSystemPrompt = commitSystemPrompt.trim();
    }

    // Prompt for PR system prompt
    const { prSystemPrompt } = await inquirer.prompt([
      {
        type: "input",
        name: "prSystemPrompt",
        message: "Custom PR instructions (optional):",
        default: existingConfig?.prSystemPrompt || "",
      },
    ]);
    if (prSystemPrompt.trim()) {
      config.prSystemPrompt = prSystemPrompt.trim();
    }

    // Save config
    await saveConfig(config);

    console.log(chalk.green(`\nConfiguration saved to ${CONFIG_FILE}`));
    console.log(chalk.gray("\nNote: API key in config file takes precedence over environment variable."));
    console.log(chalk.gray("You can override settings with environment variables:\n"));
    console.log(chalk.gray("  export CURSOR_API_KEY=your_key"));
    console.log(chalk.gray("  export RIVET_MODEL=gpt-4o"));
  } catch (error) {
    if (error && typeof error === "object" && "isTtyError" in error) {
      console.error(chalk.red("Interactive mode not available. Use environment variables instead."));
    } else {
      console.error(chalk.red("\nError:"), error instanceof Error ? error.message : String(error));
      // If we have conversation debug info on error, show it
      if (error instanceof Error && "conversation" in error && Array.isArray((error as any).conversation)) {
        const convo = (error as any).conversation;
        console.error(chalk.gray("\nDebug: Conversation structure:"), JSON.stringify(convo.map((t: any) => ({ type: t.type, stepsCount: t.type === "agent" ? t.steps?.length : 0 })), null, 2));
      }
    }
    process.exit(1);
  }
}

// CLI setup
program
  .name("rivet")
  .description("AI-powered git commit and PR creation using Cursor Agent SDK")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize rivet configuration for this project")
  .action(initCommand);

program
  .command("commit")
  .alias("c")
  .description("Create a commit with AI-generated message (automatically stages all changes)")
  .option("--no-verify", "Skip git hooks")
  .option("-y, --yes", "Skip confirmation (auto-approve)")
  .action(commitCommand);

program
  .command("pr")
  .alias("raise-pr")
  .description("Create a GitHub PR with AI-generated title, description, and labels")
  .option("-b, --base <branch>", "Base branch (default: main or master)")
  .option("--draft", "Create as draft PR")
  .option("-y, --yes", "Skip confirmation (auto-approve)")
  .action(raisePRCommand);

program.parse();

import chalk from "chalk";
import inquirer from "inquirer";
import { loadConfig, saveConfig } from "../config";
import { getBaseBranch } from "../git";
import type {
  RivetConfig,
  OverwritePromptResult,
  ApiKeyPromptResult,
  ModelPromptResult,
  BaseBranchPromptResult,
  CommitStylePromptResult,
  CommitSystemPromptResult,
  PrSystemPromptResult
} from "../types";

// Init command
export async function initCommand() {
  try {
    console.log(chalk.blue("Rivet Configuration\n"));

    const config: RivetConfig = {};
    const existingConfig = await loadConfig();

    // Check if config already exists
    if (existingConfig) {
      const { overwrite } = await inquirer.prompt<OverwritePromptResult>([
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
    const { apiKey } = await inquirer.prompt<ApiKeyPromptResult>([
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
    const { model } = await inquirer.prompt<ModelPromptResult>([
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
    const { defaultBaseBranch } = await inquirer.prompt<BaseBranchPromptResult>([
      {
        type: "input",
        name: "defaultBaseBranch",
        message: "Default base branch for PRs:",
        default: existingConfig?.defaultBaseBranch || currentBase,
      },
    ]);
    config.defaultBaseBranch = defaultBaseBranch;

    // Prompt for commit style
    const { commitStyle } = await inquirer.prompt<CommitStylePromptResult>([
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
    const { commitSystemPrompt } = await inquirer.prompt<CommitSystemPromptResult>([
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
    const { prSystemPrompt } = await inquirer.prompt<PrSystemPromptResult>([
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

    console.log(chalk.green(`\nConfiguration saved to rivet.config.json`));
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
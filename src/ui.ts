import ora from "ora";
import inquirer from "inquirer";
import type { ReplOptions, ConfirmPromptResult, FeedbackPromptResult } from "./types";

// REPL loop for interactive refinement
export async function replLoop<T>(
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

    const { accept } = await inquirer.prompt<ConfirmPromptResult>([
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
    const { feedback } = await inquirer.prompt<FeedbackPromptResult>([
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

    const spinner = ora(options.spinnerText).start();
    const newValue = await options.regenerate(feedback);

    if (newValue !== null) {
      currentValue = newValue;
      spinner.succeed("Regenerated");
    } else {
      spinner.fail("Failed to regenerate");
    }
  }
}
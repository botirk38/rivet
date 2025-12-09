import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import {
	analyzeChanges,
	createAgent,
	extractLastAssistantMessage,
	withSuppressedStderr,
} from "../agent";
import { loadConfig } from "../config";
import { createCommit, getCurrentBranch, getStagedStats, hasUpstream, pushToRemote } from "../git";
import { COMMIT_STYLE_PROMPTS } from "../prompts";
import type {
	ConfirmPromptResult,
	ConversationTurn,
	FeedbackPromptResult,
	PushPromptResult,
	TextMessage,
} from "../types";

// Commit command
export async function commitCommand(options: { "no-verify"?: boolean; yes?: boolean }) {
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
			console.log(
				chalk.yellow("\nTip: Make some changes to your files first, then run this command again."),
			);
			throw new Error("No changes to commit");
		}

		// Always stage all changes automatically (including new files)
		const stageSpinner = ora("Staging all changes...").start();
		await Bun.$`git add .`.quiet();

		// Get staged stats
		const stats = await getStagedStats();
		if (stats.length > 0) {
			stageSpinner.succeed(chalk.green(`Staged ${stats.length} file(s)`));
		} else {
			stageSpinner.succeed(chalk.green("Changes staged"));
		}

		// Verify we have staged changes
		const stagedStatus = await Bun.$`git status --porcelain`.quiet();
		const hasStagedChanges = stagedStatus.stdout
			.toString()
			.trim()
			.split("\n")
			.some((line) => {
				const status = line.substring(0, 2);
				return status.includes("A") || status.includes("M") || status.includes("D");
			});

		if (!hasStagedChanges) {
			throw new Error("No changes to commit");
		}

		const branch = await getCurrentBranch();

		// Show summary
		console.log(chalk.blue("\nSummary:"));
		console.log(chalk.gray(`   Branch: ${chalk.white(branch)}`));
		console.log(chalk.gray(`   Files: ${chalk.white(stats.length)} file(s) changed`));
		if (stats.length <= 10) {
			stats.forEach((stat) => {
				console.log(chalk.gray(`   • ${stat.file} (+${stat.insertions}/-${stat.deletions})`));
			});
		} else {
			stats.slice(0, 5).forEach((stat) => {
				console.log(chalk.gray(`   • ${stat.file} (+${stat.insertions}/-${stat.deletions})`));
			});
			console.log(chalk.gray(`   ... and ${stats.length - 5} more`));
		}

		// Analyze changes (Turn 1)
		const analyzeSpinner = ora(chalk.blue("Analyzing changes...")).start();
		const summary = await analyzeChanges({ stats, branch }, "commit");
		analyzeSpinner.succeed(chalk.green("Changes analyzed"));

		// Generate commit message (Turn 2)
		const generateSpinner = ora(chalk.blue("Generating commit message...")).start();

		const agent = await createAgent(); // Fresh agent for generation
		const config = await loadConfig();

		// Build prompt with style and system instructions
		const stylePrompt = config?.commitStyle
			? COMMIT_STYLE_PROMPTS[config.commitStyle]
			: "Create a clear, descriptive commit message.";

		const systemPrompt = config?.commitSystemPrompt ? `\n\n${config.commitSystemPrompt}` : "";

		const prompt = `${stylePrompt}${systemPrompt}

Based on this analysis of the changes:
${summary}

Generate a commit message. Return ONLY the commit message.`;

		// Stop spinner and start streaming
		generateSpinner.stop();
		console.log(chalk.blue("\nCommit message:"));
		console.log(chalk.gray("─".repeat(60)));

		let commitMessage = "";
		let streamedMessage = "";

		const result = agent.submit({
			message: prompt,
			onDelta: ({ update }) => {
				if (update.type === "text-delta" && update.text) {
					streamedMessage += update.text;
					process.stdout.write(chalk.cyan(update.text));
				}
			},
			onStep: ({ step }) => {
				if (step.type === "assistantMessage") {
					const msg = step.message as TextMessage;
					if (msg?.text) {
						commitMessage = msg.text.trim();
					}
				}
			},
		});

		const conversation = await withSuppressedStderr(async () => {
			return await result.conversation;
		});

		console.log(`\n${chalk.gray("─".repeat(60))}`);

		// Use streamed message as fallback
		if (!commitMessage) {
			const extracted = extractLastAssistantMessage(conversation as ConversationTurn[]);
			commitMessage = streamedMessage.trim() || extracted || "";
		}

		if (!commitMessage) {
			console.error(
				chalk.gray("\nDebug: Conversation structure:"),
				JSON.stringify(
					conversation.map((t) => ({
						type: (t as ConversationTurn)?.type,
						stepsCount:
							(t as ConversationTurn)?.type === "agentConversationTurn"
								? (t as ConversationTurn).turn?.steps?.length
								: 0,
					})),
					null,
					2,
				),
			);
			throw new Error("Failed to extract commit message from agent response");
		}

		// Inline confirmation loop with streaming regeneration
		let finalMessage = commitMessage;
		let accepted = false;

		try {
			while (!accepted) {
				if (options.yes) {
					accepted = true;
					break;
				}

				const { accept } = await inquirer.prompt<ConfirmPromptResult>([
					{
						type: "confirm",
						name: "accept",
						message: "Accept this commit message?",
						default: true,
					},
				]);

				if (accept) {
					accepted = true;
				} else {
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
						console.log(chalk.yellow("Cancelled. No commit created."));
						return;
					}

					// Regenerate with streaming
					console.log(chalk.gray("─".repeat(60)));

					const regenPrompt = `The previous commit message was:
${finalMessage}

The user wants this improvement: ${feedback}

Based on the same analysis of changes, generate an improved commit message. Return ONLY the commit message.`;

					let newMessage = "";
					let streamedNewMessage = "";

					const regenResult = agent.submit({
						message: regenPrompt,
						onDelta: ({ update }) => {
							if (update.type === "text-delta" && update.text) {
								streamedNewMessage += update.text;
								process.stdout.write(chalk.cyan(update.text));
							}
						},
						onStep: ({ step }) => {
							if (step.type === "assistantMessage") {
								const msg = step.message as TextMessage;
								if (msg?.text) newMessage = msg.text.trim();
							}
						},
					});

					const regenConversation = await withSuppressedStderr(async () => {
						return await regenResult.conversation;
					});

					console.log(`\n${chalk.gray("─".repeat(60))}`);

					const extracted = extractLastAssistantMessage(regenConversation as ConversationTurn[]);
					finalMessage = newMessage || streamedNewMessage.trim() || extracted || finalMessage;
				}
			}
		} catch (_error) {
			// Handle prompt cancellation (Ctrl+C) or other inquirer errors
			console.log(chalk.yellow("\nCancelled. No commit created."));
			return;
		}

		// Create commit
		const commitSpinner = ora("Creating commit...").start();
		await createCommit(finalMessage, options["no-verify"]);
		commitSpinner.succeed(chalk.green("Commit created successfully!"));

		// Ask about pushing to remote
		const { push } = await inquirer.prompt<PushPromptResult>([
			{
				type: "confirm",
				name: "push",
				message: "Push to remote?",
				default: true,
			},
		]);

		if (push) {
			const pushSpinner = ora("Pushing to remote...").start();
			try {
				const branch = await getCurrentBranch();
				const hasUpstreamBranch = await hasUpstream();

				await pushToRemote(branch, !hasUpstreamBranch);

				if (hasUpstreamBranch) {
					pushSpinner.succeed(chalk.green("Pushed to remote"));
				} else {
					pushSpinner.succeed(chalk.green(`Pushed to remote (set upstream to origin/${branch})`));
				}
			} catch (_error) {
				pushSpinner.fail(chalk.red("Failed to push to remote"));
				console.log(chalk.gray("You can push manually with: git push"));
				// Don't exit with error since commit succeeded
			}
		}

		console.log(chalk.green("\nDone!"));
	} catch (error) {
		console.error(chalk.red("\nError:"), error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

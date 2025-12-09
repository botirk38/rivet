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
import {
	getBaseBranch,
	getBranchCommits,
	getBranchStats,
	getCurrentBranch,
	getPRTemplate,
	hasUncommittedChanges,
} from "../git";
import type { CommitFirstPromptResult, ConversationTurn, PrData, TextMessage } from "../types";
import { replLoop } from "../ui";
import { commitCommand } from "./commit";

// Raise PR command
export async function raisePRCommand(options: { base?: string; draft?: boolean; yes?: boolean }) {
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
		const baseBranch = options.base || config?.defaultBaseBranch || (await getBaseBranch());

		// Stage all changes first
		const stageSpinner = ora("Staging changes...").start();
		await Bun.$`git add .`.quiet();
		stageSpinner.succeed(chalk.green("Changes staged"));

		// Check for uncommitted changes
		if (await hasUncommittedChanges()) {
			const { commitFirst } = await inquirer.prompt<CommitFirstPromptResult>([
				{
					type: "confirm",
					name: "commitFirst",
					message: "You have uncommitted changes. Commit them first?",
					default: true,
				},
			]);

			if (commitFirst) {
				console.log(chalk.blue("\nCommitting changes first...\n"));
				await commitCommand({ "no-verify": false, yes: false });
				console.log(""); // Add spacing
			} else {
				console.log(chalk.yellow("Warning: Uncommitted changes will not be included in the PR.\n"));
			}
		}

		// Get changes data
		const stats = await getBranchStats(baseBranch);
		const commits = await getBranchCommits(baseBranch);
		const commitsList = commits.trim().split("\n").filter(Boolean);

		if (stats.length === 0 && !commits.trim()) {
			throw new Error(`No changes found between ${baseBranch} and ${currentBranch}`);
		}

		// Check for PR template
		const prTemplate = await getPRTemplate();
		if (prTemplate) {
			console.log(chalk.gray(`✓ Found PR template: .github/PULL_REQUEST_TEMPLATE.md`));
		}

		// Show summary
		console.log(chalk.blue("\nSummary:"));
		console.log(
			chalk.gray(`   Branch: ${chalk.white(currentBranch)} → ${chalk.white(baseBranch)}`),
		);
		console.log(chalk.gray(`   Files: ${chalk.white(stats.length)} file(s) changed`));
		console.log(chalk.gray(`   Commits: ${chalk.white(commitsList.length)} commit(s)`));
		if (commitsList.length > 0 && commitsList.length <= 5) {
			commitsList.forEach((commit) => {
				console.log(chalk.gray(`   • ${commit}`));
			});
		} else if (commitsList.length > 5) {
			commitsList.slice(0, 3).forEach((commit) => {
				console.log(chalk.gray(`   • ${commit}`));
			});
			console.log(chalk.gray(`   ... and ${commitsList.length - 3} more`));
		}

		// Analyze changes (Turn 1)
		const analyzeSpinner = ora(chalk.blue("Analyzing changes...")).start();
		const summary = await analyzeChanges(
			{ stats, branch: currentBranch, commits, prTemplate: prTemplate || undefined },
			"pr",
		);
		analyzeSpinner.succeed(chalk.green("Changes analyzed"));

		// Generate PR content (Turn 2)
		const generateSpinner = ora(chalk.blue("Generating PR content...")).start();

		const agent = await createAgent(); // Fresh agent for generation
		const prConfig = await loadConfig();

		// Build prompt with system instructions and template
		const systemPrompt = prConfig?.prSystemPrompt ? `${prConfig.prSystemPrompt}\n\n` : "";

		let prompt: string;
		if (prTemplate) {
			prompt = `${systemPrompt}Based on this analysis of the changes:
${summary}

Generate PR content following this template:

---TEMPLATE START---
${prTemplate}
---TEMPLATE END---

Fill in all sections appropriately. Keep any section headers but replace
placeholder text with actual content based on the changes.

Return ONLY valid JSON in this exact format:
{
  "title": "PR title here",
  "body": "filled template content",
  "labels": ["label1", "label2"]
}

Use appropriate labels like: bug, feature, enhancement, documentation, refactor, etc.`;
		} else {
			prompt = `${systemPrompt}Based on this analysis of the changes:
${summary}

Generate PR content.

Return ONLY valid JSON in this exact format:
{
  "title": "PR title here",
  "body": "PR description here. Explain what changed and why.",
  "labels": ["label1", "label2"]
}

Use appropriate labels like: bug, feature, enhancement, documentation, refactor, etc.`;
		}

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
					const msg = step.message as TextMessage;
					if (msg?.text) {
						responseText = msg.text.trim();
					}
				}
			},
		});

		const conversation = await withSuppressedStderr(async () => {
			return await result.conversation;
		});

		// If onStep didn't capture, fall back to scanning conversation (functional style)
		if (!responseText) {
			responseText = extractLastAssistantMessage(conversation as ConversationTurn[]) ?? "";
		}

		if (!responseText) {
			generateSpinner.fail(chalk.red("Failed to extract PR content from agent response"));
			const debugInfo = conversation.map((t) => ({
				type: (t as ConversationTurn)?.type,
				stepsCount:
					(t as ConversationTurn)?.type === "agentConversationTurn"
						? (t as ConversationTurn).turn?.steps?.length
						: 0,
			}));
			console.error(
				chalk.gray("\nDebug: Conversation structure:"),
				JSON.stringify(debugInfo, null, 2),
			);
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

		let prData: PrData;
		try {
			prData = JSON.parse(jsonText);
		} catch (_error) {
			generateSpinner.fail(chalk.red("Failed to parse agent response as JSON"));
			throw new Error("Failed to parse agent response as JSON");
		}

		if (!prData.title || !prData.body) {
			generateSpinner.fail(chalk.red("Agent response missing title or body"));
			throw new Error("Agent response missing title or body");
		}

		generateSpinner.succeed(chalk.green("PR content generated"));

		// Helper to generate PR content with agent (continues conversation)
		const generatePrContent = async (prompt: string): Promise<PrData | null> => {
			let text = "";
			const genResult = agent.submit({
				message: prompt,
				onStep: ({ step }) => {
					if (step.type === "assistantMessage") {
						const msg = step.message as TextMessage;
						if (msg?.text) text = msg.text.trim();
					}
				},
			});
			const convo = await withSuppressedStderr(async () => {
				return await genResult.conversation;
			});
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
				? data.labels.map((l) => chalk.cyan(`"${l}"`)).join(", ")
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
					const templateSection = prTemplate
						? `\n\nFollow this template:\n---TEMPLATE START---\n${prTemplate}\n---TEMPLATE END---\n\nFill in all sections appropriately.`
						: "";

					const prompt = `The previous PR content was:
Title: ${prData.title}
Body: ${prData.body}
Labels: ${prData.labels?.join(", ") ?? "none"}

The user wants this improvement: ${feedback}

Based on the same analysis of changes, generate improved PR content.${templateSection}

Return ONLY valid JSON in this exact format:
{
  "title": "PR title here",
  "body": "${prTemplate ? "filled template content" : "PR description here. Explain what changed and why."}",
  "labels": ["label1", "label2"]
}`;
					return generatePrContent(prompt);
				},
				spinnerText: "Regenerating PR content...",
				confirmMessage: "Accept this PR content?",
			},
			options.yes ?? false,
		);

		if (!accepted) {
			console.log(chalk.yellow("Cancelled. No PR created."));
			return;
		}

		// Create PR using gh CLI
		const createSpinner = ora("Creating PR on GitHub...").start();
		const draftFlag = options.draft ? ["--draft"] : [];

		try {
			const prResult =
				await Bun.$`gh pr create --title ${finalPrData.title} --body ${finalPrData.body} --base ${baseBranch} ${draftFlag}`.quiet();
			const prUrl = prResult.stdout.toString().trim();
			createSpinner.succeed(chalk.green("PR created successfully!"));
			console.log(chalk.green("\nPR created:"), chalk.cyan.underline(prUrl));

			// Note about labels if any were suggested
			if (finalPrData.labels?.length) {
				console.log(
					chalk.gray(
						`\nTip: Suggested labels (${finalPrData.labels.join(", ")}) can be added manually on GitHub.`,
					),
				);
			}
		} catch (error) {
			createSpinner.fail(chalk.red("Failed to create PR"));

			// Show the actual error from gh CLI
			if (error && typeof error === "object" && "stderr" in error) {
				const stderr = (error as any).stderr?.toString?.() || "";
				if (stderr) {
					console.error(chalk.gray("GitHub CLI error:"), stderr.trim());
				}
			}

			throw error;
		}
	} catch (error) {
		console.error(chalk.red("\nError:"), error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

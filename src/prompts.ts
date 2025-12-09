import type { CommitStyle } from "./types";

// Commit style prompts
export const COMMIT_STYLE_PROMPTS: Record<CommitStyle, string> = {
  conventional: "Use conventional commit format: type(scope): subject. Examples: feat(auth): add OAuth login, fix(ui): resolve button alignment, docs(readme): update installation instructions.",
  angular: "Use Angular commit format with detailed body. Include type(scope): subject line, then detailed body explaining what changed and why. Include breaking changes section if applicable.",
  simple: "Write a clear, concise one-line commit message that describes what changed and why.",
  emoji: "Use gitmoji format: 🎉 type: subject. Examples: ✨ feat: add OAuth login, 🐛 fix: resolve button alignment, 📚 docs: update installation instructions."
};
#!/usr/bin/env bun

import { Command } from "commander";
import { initCommand, commitCommand, raisePRCommand } from "./src";

const program = new Command();

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
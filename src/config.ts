import { join } from "path";
import { CONFIG_FILE } from "./constants";
import type { RivetConfig } from "./types";

// Load config from file
export async function loadConfig(): Promise<RivetConfig | null> {
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
export async function saveConfig(config: RivetConfig): Promise<void> {
  const configPath = join(process.cwd(), CONFIG_FILE);
  await Bun.write(configPath, JSON.stringify(config, null, 2));
}
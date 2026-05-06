import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getConfigDir } from "../../lib/config.js";

export interface AgentModelConfig {
  provider: string;
  model: string;
}

interface ProfileConfig extends AgentModelConfig {
  id?: string;
}

const ROLE_PROFILE_MAP: Record<string, string[]> = {
  "jce-worker": ["claude-opus", "opus", "anthropic-opus"],
  oracle: ["gpt-o1", "o1", "openai-o1", "gpt"],
  "jce-researcher": ["claude-sonet", "sonet", "anthropic-sonet", "claude-sonnet"],
  explorer: ["grok", "gemini-flash", "haiku", "claude-haiku"],
  frontend: ["gemini", "gemini-pro", "google-gemini"],
};

const FALLBACK: AgentModelConfig = { provider: "anthropic", model: "claude-sonnet-4-20250514" };

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function isConfiguredModel(configDir: string, profile: AgentModelConfig): boolean {
  const opencodeJson = readJsonFile<{ provider?: Record<string, { models?: Record<string, unknown> }> }>(join(configDir, "opencode.json"));
  if (!opencodeJson?.provider) return true;

  const provider = opencodeJson.provider[profile.provider];
  return Boolean(provider?.models && profile.model in provider.models);
}

function readProfile(profilesDir: string, file: string): ProfileConfig | null {
  const profile = readJsonFile<ProfileConfig>(join(profilesDir, file));
  if (profile?.provider && profile.model) return profile;
  return null;
}

function resolveFromConfiguredProviders(configDir: string): AgentModelConfig | null {
  const opencodeJson = readJsonFile<{ provider?: Record<string, { models?: Record<string, unknown> }> }>(join(configDir, "opencode.json"));
  if (!opencodeJson?.provider) return null;

  for (const [provider, config] of Object.entries(opencodeJson.provider)) {
    const models = Object.keys(config.models ?? {});
    const preferred = models.find((model) => model.includes("gpt-5.5"))
      ?? models.find((model) => model.includes("opus"))
      ?? models.find((model) => model.includes("sonnet"))
      ?? models.find((model) => model.includes("gpt-5"))
      ?? models[0];
    if (preferred) return { provider, model: preferred };
  }

  return null;
}

export function resolveAgentModel(role: string): AgentModelConfig {
  const configDir = getConfigDir();
  const profilesDir = join(configDir, "profiles");

  if (!existsSync(profilesDir)) return resolveFromConfiguredProviders(configDir) ?? FALLBACK;

  const profileFiles = readdirSync(profilesDir).filter((f) => f.endsWith(".json"));
  const candidates = ROLE_PROFILE_MAP[role] ?? [];

  for (const candidate of candidates) {
    const match = profileFiles.find((f) => f.replace(".json", "") === candidate);
    if (match) {
      const profile = readProfile(profilesDir, match);
      if (profile && isConfiguredModel(configDir, profile)) return { provider: profile.provider, model: profile.model };
    }
  }

  // Fallback: use first available profile
  for (const file of profileFiles) {
    const profile = readProfile(profilesDir, file);
    if (profile && isConfiguredModel(configDir, profile)) return { provider: profile.provider, model: profile.model };
  }

  return resolveFromConfiguredProviders(configDir) ?? FALLBACK;
}

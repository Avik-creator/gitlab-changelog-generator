import type { Env, DiscordCommandOption, DigestMode } from "../../types";
import { getGlobalConfig, setGlobalConfig, getUserConfig, setUserConfig } from "../../kv/config";
import { buildConfigEmbed, buildSuccessEmbed, buildErrorEmbed } from "../embeds";

function getOpt(opts: DiscordCommandOption[], name: string): string | undefined {
  return opts.find((o) => o.name === name)?.value as string | undefined;
}

async function patch(appId: string, token: string, body: object): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

export async function handleConfig(
  appId: string, token: string, subcommand: string,
  options: DiscordCommandOption[], env: Env, requesterId: string
): Promise<void> {
  switch (subcommand) {
    case "show": return configShow(appId, token, env, requesterId);
    case "set":  return configSet(appId, token, options, env, requesterId);
    case "global-show": return globalShow(appId, token, env);
    case "global-set":  return globalSet(appId, token, options, env);
    default:
      await patch(appId, token, buildErrorEmbed("Unknown", `\`config ${subcommand}\` not found.`));
  }
}

async function configShow(appId: string, token: string, env: Env, requesterId: string): Promise<void> {
  const config = await getUserConfig(env.USERS_KV, requesterId);
  await patch(appId, token, buildConfigEmbed("Your Config", config as unknown as Record<string, unknown>));
}

async function configSet(appId: string, token: string, opts: DiscordCommandOption[], env: Env, requesterId: string): Promise<void> {
  const key = getOpt(opts, "key");
  const value = getOpt(opts, "value");
  if (!key || !value) {
    await patch(appId, token, buildErrorEmbed("Missing args", "Provide `key` and `value`."));
    return;
  }

  try {
    const updates: Record<string, unknown> = {};

    switch (key) {
      case "style":
        updates.style = value as DigestMode;
        break;
      case "verbosity":
        updates.verbosity = value;
        break;
      case "timezone":
        updates.timezone = value;
        break;
      case "exclude-labels":
        updates.filters = { excludeLabels: value.split(",").map((s) => s.trim()) };
        break;
      case "include-repos":
        updates.includeRepos = value.split(",").map((s) => s.trim());
        break;
      case "exclude-repos":
        updates.excludeRepos = value.split(",").map((s) => s.trim());
        break;
      case "min-lines":
        updates.filters = { minLines: parseInt(value) };
        break;
      case "include-drafts":
        updates.filters = { includeDrafts: value === "true" };
        break;
      case "exclude-bots":
        updates.filters = { excludeBotAuthors: value === "true" };
        break;
      default:
        await patch(appId, token, buildErrorEmbed("Unknown key", `Valid keys: style, verbosity, timezone, exclude-labels, include-repos, exclude-repos, min-lines, include-drafts, exclude-bots`));
        return;
    }

    await setUserConfig(env.USERS_KV, requesterId, updates as any);
    await patch(appId, token, buildSuccessEmbed("Config updated", `\`${key}\` = \`${value}\``));
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Config failed", String(err)));
  }
}

async function globalShow(appId: string, token: string, env: Env): Promise<void> {
  const config = await getGlobalConfig(env.USERS_KV);
  await patch(appId, token, buildConfigEmbed("Global Config", config as unknown as Record<string, unknown>));
}

async function globalSet(appId: string, token: string, opts: DiscordCommandOption[], env: Env): Promise<void> {
  const key = getOpt(opts, "key");
  const value = getOpt(opts, "value");
  if (!key || !value) {
    await patch(appId, token, buildErrorEmbed("Missing args", "Provide `key` and `value`."));
    return;
  }

  try {
    const updates: Record<string, unknown> = {};

    switch (key) {
      case "default-style":
        updates.defaultStyle = value as DigestMode;
        break;
      case "exclude-labels":
        updates.filters = { excludeLabels: value.split(",").map((s) => s.trim()) };
        break;
      case "min-lines":
        updates.filters = { minLines: parseInt(value) };
        break;
      case "exclude-bots":
        updates.filters = { excludeBotAuthors: value === "true" };
        break;
      default:
        await patch(appId, token, buildErrorEmbed("Unknown key", `Valid keys: default-style, exclude-labels, min-lines, exclude-bots`));
        return;
    }

    await setGlobalConfig(env.USERS_KV, updates as any);
    await patch(appId, token, buildSuccessEmbed("Global config updated", `\`${key}\` = \`${value}\``));
  } catch (err) {
    await patch(appId, token, buildErrorEmbed("Config failed", String(err)));
  }
}

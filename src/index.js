const path = require("path");
const dotenv = require("dotenv");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ApplicationCommandOptionType,
  MessageFlags
} = require("discord.js");
const { fetchAccountByRiotId, fetchTftRankByPuuid } = require("./api/riotApi");
const { ensureDataFiles, readJson, writeJson } = require("./utils/storage");
const { formatLeaderboard, sortLeaderboard } = require("./utils/leaderboard");

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const DEFAULT_REGION = (process.env.DEFAULT_REGION || "NA1").toUpperCase();
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const CHECKWINNER_GUILD_ID = "1323156393527742539";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const REGISTRATIONS_PATH = path.join(DATA_DIR, "registrations.json");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const COMMANDS = [
  {
    name: "register",
    description: "Register a Riot ID",
    options: [
      {
        name: "riot_id",
        description: "RiotName#TAG",
        type: ApplicationCommandOptionType.String,
        required: true
      }
    ]
  },
  {
    name: "leaderboard",
    description: "Show the TFT leaderboard"
  },
  {
    name: "unregister",
    description: "Remove a Riot ID",
    options: [
      {
        name: "riot_id",
        description: "RiotName#TAG",
        type: ApplicationCommandOptionType.String,
        required: true
      }
    ]
  },
  {
    name: "lockleaderboard",
    description: "Lock the leaderboard"
  },
  {
    name: "unlockleaderboard",
    description: "Unlock the leaderboard"
  }
];

const CHECKWINNER_COMMAND = {
  name: "checkwinner",
  description: "Molediver Cup only: check for a Diamond+ winner and lock the leaderboard"
};

function parseRiotId(input) {
  const trimmed = input.trim();
  const parts = trimmed.split("#");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { gameName: parts[0], tagLine: parts[1] };
}

function normalizeRiotIdString(riotId) {
  return riotId.replace(/\s+/g, "").toLowerCase();
}

function getConfig(guildId) {
  const config = readJson(CONFIG_PATH, { servers: {} });
  if (!config.servers) config.servers = {};
  if (!config.servers[guildId]) {
    config.servers[guildId] = {
      lockedLeaderboard: null
    };
  }
  return config.servers[guildId];
}

function setGuildConfig(guildId, guildConfig) {
  const config = readJson(CONFIG_PATH, { servers: {} });
  if (!config.servers) config.servers = {};
  config.servers[guildId] = guildConfig;
  writeJson(CONFIG_PATH, config);
}

async function requireGuildId(interaction) {
  if (interaction.guildId) {
    return interaction.guildId;
  }
  await interaction.reply({
    content: "This command can only be used in a server.",
    flags: MessageFlags.Ephemeral
  });
  return null;
}

function formatVancouverDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function serializeLeaderboardResults(results) {
  return results.map((result) => ({
    riotId: result.riotId,
    region: result.region,
    rankEntry: result.rankEntry,
    error: result.error
  }));
}

function isDiamondOrHigher(rankEntry) {
  if (!rankEntry?.tier) {
    return false;
  }
  if (rankEntry.tier === "DIAMOND") {
    return rankEntry.rank === "IV" && (rankEntry.leaguePoints ?? 0) >= 0;
  }
  return ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rankEntry.tier);
}

async function buildLeaderboard(registrations, guildId) {
  const guildData = (registrations.servers && registrations.servers[guildId]) || { users: {} };
  const users = Object.values(guildData.users || {});
  const results = [];

  for (const user of users) {
    try {
      const rankEntry = await fetchTftRankByPuuid(user.puuid, user.region, RIOT_API_KEY);
      results.push({
        riotId: user.riotId,
        region: user.region,
        rankEntry,
        error: null
      });
    } catch (error) {
      results.push({
        riotId: user.riotId,
        region: user.region,
        rankEntry: null,
        error: error.message
      });
    }
  }

  return sortLeaderboard(results);
}

async function getLeaderboardState(guildId) {
  const config = getConfig(guildId);

  if (config.lockedLeaderboard) {
    const winnerName = config.lockedLeaderboard.winner?.riotId;
    const lockedTime = formatVancouverDate(new Date(config.lockedLeaderboard.lockedAt));
    const header = winnerName
      ? `**Congrats to ${winnerName} for winning Molediver Cup V3. Leaderboard locked at ${lockedTime}**`
      : `**Leaderboard locked at ${lockedTime}**`;
    return {
      locked: true,
      results: config.lockedLeaderboard.results || [],
      lockedAt: config.lockedLeaderboard.lockedAt,
      header
    };
  }

  const registrations = readJson(REGISTRATIONS_PATH, { servers: {} });
  const results = await buildLeaderboard(registrations, guildId);

  return {
    locked: false,
    results,
    lockedAt: null,
    header: "**TFT Leaderboard**"
  };
}

async function handleRegister(interaction) {
  const guildId = await requireGuildId(interaction);
  if (!guildId) {
    return;
  }
  const riotIdInput = interaction.options.getString("riot_id", true);
  const riotId = parseRiotId(riotIdInput);
  if (!riotId) {
    await interaction.reply({
      content: "Use /register riot_id:RiotName#TAG",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const region = DEFAULT_REGION;

  try {
    const account = await fetchAccountByRiotId(riotId, region, RIOT_API_KEY);
    const registrations = readJson(REGISTRATIONS_PATH, { servers: {} });
    if (!registrations.servers) registrations.servers = {};
    if (!registrations.servers[guildId]) registrations.servers[guildId] = { users: {} };

    registrations.servers[guildId].users = registrations.servers[guildId].users || {};
    const canonicalRiotId = `${account.gameName}#${account.tagLine}`;
    const entryKey = `${canonicalRiotId}:${region}`;
    registrations.servers[guildId].users[entryKey] = {
      riotId: `${account.gameName}#${account.tagLine}`,
      region,
      puuid: account.puuid,
      lastUpdated: new Date().toISOString()
    };
    writeJson(REGISTRATIONS_PATH, registrations);

    await interaction.reply(`Registered ${canonicalRiotId} (${region}).`);
  } catch (error) {
    await interaction.reply({
      content: `Registration failed: ${error.message}`,
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleLeaderboard(interaction) {
  const guildId = await requireGuildId(interaction);
  if (!guildId) {
    return;
  }
  const leaderboardState = await getLeaderboardState(guildId);
  await interaction.reply(formatLeaderboard(leaderboardState.results, { header: leaderboardState.header }));
}

async function handleUnregister(interaction) {
  const guildId = await requireGuildId(interaction);
  if (!guildId) {
    return;
  }
  const registrations = readJson(REGISTRATIONS_PATH, { servers: {} });
  const guildData = registrations.servers?.[guildId] || { users: {} };
  const riotIdInput = interaction.options.getString("riot_id", true);
  const parsed = parseRiotId(riotIdInput);
  if (!parsed) {
    await interaction.reply({
      content: "Use /unregister riot_id:RiotName#TAG",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const region = DEFAULT_REGION;
  const normalizedTarget = normalizeRiotIdString(`${parsed.gameName}#${parsed.tagLine}`);
  const entries = Object.entries(guildData.users || {});
  const match = entries.find(([, value]) => {
    const normalizedStored = normalizeRiotIdString(value.riotId || "");
    return normalizedStored === normalizedTarget && value.region === region;
  });

  if (match) {
    const [key] = match;
    delete guildData.users[key];
    if (!registrations.servers) registrations.servers = {};
    registrations.servers[guildId] = guildData;
    writeJson(REGISTRATIONS_PATH, registrations);
    await interaction.reply("Registration removed.");
    return;
  }

  await interaction.reply({ content: "Riot ID not found.", flags: MessageFlags.Ephemeral });
}

async function handleLockLeaderboard(interaction) {
  const guildId = await requireGuildId(interaction);
  if (!guildId) {
    return;
  }
  const config = getConfig(guildId);
  const registrations = readJson(REGISTRATIONS_PATH, { servers: {} });
  const results = await buildLeaderboard(registrations, guildId);
  const lockedAt = new Date().toISOString();

  config.lockedLeaderboard = {
    lockedAt,
    results: serializeLeaderboardResults(results),
    winner: null
  };

  setGuildConfig(guildId, config);
  await interaction.reply("Leaderboard locked.");
}

async function handleUnlockLeaderboard(interaction) {
  const guildId = await requireGuildId(interaction);
  if (!guildId) {
    return;
  }
  const config = getConfig(guildId);
  config.lockedLeaderboard = null;
  setGuildConfig(guildId, config);
  await interaction.reply("Leaderboard unlocked.");
}

async function handleCheckWinner(interaction) {
  const guildId = await requireGuildId(interaction);
  if (!guildId) {
    return;
  }

  if (guildId !== CHECKWINNER_GUILD_ID) {
    await interaction.reply({
      content: "This command is for Molediver Cup only.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const registrations = readJson(REGISTRATIONS_PATH, { servers: {} });
  const results = await buildLeaderboard(registrations, guildId);
  const topCandidate = results.find((result) => !result.error && isDiamondOrHigher(result.rankEntry));

  if (!topCandidate) {
    await interaction.reply("No Diamond+ winner found yet.");
    return;
  }

  const config = getConfig(guildId);
  const lockedAt = new Date().toISOString();
  config.lockedLeaderboard = {
    lockedAt,
    results: serializeLeaderboardResults(results),
    winner: {
      riotId: topCandidate.riotId,
      region: topCandidate.region
    }
  };

  setGuildConfig(guildId, config);
  await interaction.reply(
    `Congrats to ${topCandidate.riotId} for winning Molediver Cup V3. Leaderboard locked at ${formatVancouverDate(
      new Date(lockedAt)
    )}`
  );
}

client.on("ready", async () => {
  ensureDataFiles(DATA_DIR, REGISTRATIONS_PATH, CONFIG_PATH);
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const registerCommands = async () => {
    try {
      if (DISCORD_GUILD_ID) {
        const guildCommands =
          DISCORD_GUILD_ID === CHECKWINNER_GUILD_ID
            ? [...COMMANDS, CHECKWINNER_COMMAND]
            : COMMANDS;
        await rest.put(Routes.applicationGuildCommands(client.user.id, DISCORD_GUILD_ID), {
          body: guildCommands
        });
      } else {
        await rest.put(Routes.applicationCommands(client.user.id), { body: COMMANDS });
        await rest.put(Routes.applicationGuildCommands(client.user.id, CHECKWINNER_GUILD_ID), {
          body: [CHECKWINNER_COMMAND]
        });
      }
      console.log("Slash commands registered.");
    } catch (error) {
      console.error("Failed to register slash commands:", error.message);
    }
  };

  registerCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  switch (interaction.commandName) {
    case "register":
      await handleRegister(interaction);
      break;
    case "leaderboard":
      await handleLeaderboard(interaction);
      break;
    case "unregister":
      await handleUnregister(interaction);
      break;
    case "lockleaderboard":
      await handleLockLeaderboard(interaction);
      break;
    case "unlockleaderboard":
      await handleUnlockLeaderboard(interaction);
      break;
    case "checkwinner":
      await handleCheckWinner(interaction);
      break;
    default:
      break;
  }
});

if (!DISCORD_TOKEN || !RIOT_API_KEY) {
  console.error("Missing DISCORD_TOKEN or RIOT_API_KEY in environment.");
  process.exit(1);
}

client.login(DISCORD_TOKEN);

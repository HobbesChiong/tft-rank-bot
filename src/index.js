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
const SCHEDULE_HOURS = Number(process.env.SCHEDULE_HOURS || "6");
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";
const SEED_RIOT_IDS = (process.env.SEED_RIOT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DATA_DIR = path.join(__dirname, "..", "data");
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
    name: "setchannel",
    description: "Set this channel for scheduled leaderboard posts"
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
  }
];

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

async function buildLeaderboard(registrations) {
  const users = Object.values(registrations.users || {});
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

async function handleRegister(interaction) {
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
    const registrations = readJson(REGISTRATIONS_PATH, { users: {} });
    registrations.users = registrations.users || {};
    const canonicalRiotId = `${account.gameName}#${account.tagLine}`;
    const entryKey = `${canonicalRiotId}:${region}`;
    registrations.users[entryKey] = {
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
  const registrations = readJson(REGISTRATIONS_PATH, { users: {} });
  const results = await buildLeaderboard(registrations);
  await interaction.reply(formatLeaderboard(results));
}

async function handleSetChannel(interaction) {
  const config = readJson(CONFIG_PATH, { leaderboardChannelId: null });
  config.leaderboardChannelId = interaction.channelId;
  writeJson(CONFIG_PATH, config);
  await interaction.reply("Leaderboard channel saved.");
}

async function handleUnregister(interaction) {
  const registrations = readJson(REGISTRATIONS_PATH, { users: {} });
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
  const entries = Object.entries(registrations.users || {});
  const match = entries.find(([, value]) => {
    const normalizedStored = normalizeRiotIdString(value.riotId || "");
    return normalizedStored === normalizedTarget && value.region === region;
  });

  if (match) {
    const [key] = match;
    delete registrations.users[key];
    writeJson(REGISTRATIONS_PATH, registrations);
    await interaction.reply("Registration removed.");
    return;
  }

  await interaction.reply({ content: "Riot ID not found.", flags: MessageFlags.Ephemeral });
}

async function postScheduledLeaderboard() {
  const config = readJson(CONFIG_PATH, { leaderboardChannelId: null });
  if (!config.leaderboardChannelId) {
    return;
  }
  const channel = await client.channels.fetch(config.leaderboardChannelId).catch(() => null);
  if (!channel) {
    return;
  }
  const registrations = readJson(REGISTRATIONS_PATH, { users: {} });
  const results = await buildLeaderboard(registrations);
  await channel.send(formatLeaderboard(results));
}

async function seedRegistrations() {
  if (!SEED_RIOT_IDS.length) return;
  const registrations = readJson(REGISTRATIONS_PATH, { users: {} });
  registrations.users = registrations.users || {};
  let changed = false;

  for (const rawId of SEED_RIOT_IDS) {
    const parsed = parseRiotId(rawId);
    if (!parsed) {
      console.warn(`SEED_RIOT_IDS: skipping invalid entry "${rawId}"`);
      continue;
    }
    const entryKey = `${rawId}:${DEFAULT_REGION}`;
    if (registrations.users[entryKey]) {
      continue; // already registered, skip
    }
    try {
      const account = await fetchAccountByRiotId(parsed, DEFAULT_REGION, RIOT_API_KEY);
      const canonicalRiotId = `${account.gameName}#${account.tagLine}`;
      const canonicalKey = `${canonicalRiotId}:${DEFAULT_REGION}`;
      registrations.users[canonicalKey] = {
        riotId: canonicalRiotId,
        region: DEFAULT_REGION,
        puuid: account.puuid,
        lastUpdated: new Date().toISOString()
      };
      changed = true;
      console.log(`Seeded: ${canonicalRiotId}`);
    } catch (err) {
      console.error(`SEED_RIOT_IDS: failed to seed "${rawId}": ${err.message}`);
    }
  }

  if (changed) writeJson(REGISTRATIONS_PATH, registrations);
}

client.on("ready", async () => {
  ensureDataFiles(DATA_DIR, REGISTRATIONS_PATH, CONFIG_PATH);
  console.log(`Logged in as ${client.user.tag}`);
  await seedRegistrations();

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const registerCommands = async () => {
    try {
      if (DISCORD_GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(client.user.id, DISCORD_GUILD_ID), {
          body: COMMANDS
        });
      } else {
        await rest.put(Routes.applicationCommands(client.user.id), { body: COMMANDS });
      }
      console.log("Slash commands registered.");
    } catch (error) {
      console.error("Failed to register slash commands:", error.message);
    }
  };

  registerCommands();

  if (Number.isFinite(SCHEDULE_HOURS) && SCHEDULE_HOURS > 0) {
    const intervalMs = SCHEDULE_HOURS * 60 * 60 * 1000;
    setInterval(() => {
      postScheduledLeaderboard().catch((error) => {
        console.error("Leaderboard post failed:", error.message);
      });
    }, intervalMs);
  }
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
    case "setchannel":
      await handleSetChannel(interaction);
      break;
    case "unregister":
      await handleUnregister(interaction);
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

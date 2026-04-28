const axios = require("axios");

const PLATFORM_TO_ACCOUNT_ROUTE = {
  NA1: "americas",
  BR1: "americas",
  LA1: "americas",
  LA2: "americas",
  EUW1: "europe",
  EUN1: "europe",
  TR1: "europe",
  RU: "europe",
  KR: "asia",
  JP1: "asia",
  OC1: "asia",
  PH2: "asia",
  SG2: "asia",
  TH2: "asia",
  TW2: "asia",
  VN2: "asia"
};

function getAccountRoute(region) {
  return PLATFORM_TO_ACCOUNT_ROUTE[region.toUpperCase()] || null;
}

async function riotRequest(url, apiKey) {
  try {
    const response = await axios.get(url, {
      headers: { "X-Riot-Token": apiKey }
    });
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    const data = error.response?.data;
    if (status) {
      const detail = data ? JSON.stringify(data) : "";
      throw new Error(`Riot API ${status}${detail ? `: ${detail}` : ""} (${url})`);
    }
    throw error;
  }
}

async function fetchAccountByRiotId(riotId, region, apiKey) {
  const accountRoute = getAccountRoute(region);
  if (!accountRoute) {
    throw new Error(`Unsupported region: ${region}`);
  }
  const encodedName = encodeURIComponent(riotId.gameName);
  const encodedTag = encodeURIComponent(riotId.tagLine);
  const accountUrl = `https://${accountRoute}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`;
  const account = await riotRequest(accountUrl, apiKey);
  if (!account?.puuid) {
    throw new Error(`Riot account lookup missing PUUID (${accountUrl})`);
  }
  return account;
}

async function fetchTftRankByPuuid(puuid, region, apiKey) {
  const url = `https://${region.toLowerCase()}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}`;
  const entries = await riotRequest(url, apiKey);
  const rankedEntry = Array.isArray(entries)
    ? entries.find((entry) => entry.queueType === "RANKED_TFT")
    : null;
  return rankedEntry || null;
}

module.exports = {
  fetchAccountByRiotId,
  fetchTftRankByPuuid
};

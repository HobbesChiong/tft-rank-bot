const TIER_ORDER = [
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON",
  "UNRANKED"
];

const TIER_EMOJI = {
  CHALLENGER: "🏆",
  GRANDMASTER: "🥇",
  MASTER: "🥈",
  DIAMOND: "💎",
  EMERALD: "🟩",
  PLATINUM: "🔷",
  GOLD: "🟨",
  SILVER: "⚪",
  BRONZE: "🟫",
  IRON: "⛓️",
  UNRANKED: "❔"
};

const PLACE_EMOJI = ["🥇", "🥈", "🥉"];

function getTierEmoji(tier) {
  return TIER_EMOJI[tier] || TIER_EMOJI.UNRANKED;
}

function buildRankDisplay(entry) {
  if (!entry) {
    return `${TIER_EMOJI.UNRANKED} Unranked`;
  }
  const tier = entry.tier || "UNRANKED";
  const wins = entry.wins ?? 0;
  const losses = entry.losses ?? 0;
  const emoji = getTierEmoji(tier);
  if (tier === "MASTER" || tier === "GRANDMASTER" || tier === "CHALLENGER") {
    return `${emoji} ${tier} ${entry.leaguePoints} LP (${wins}W ${losses}L)`;
  }
  const division = entry.rank || "";
  const lp = entry.leaguePoints ?? 0;
  return `${emoji} ${tier} ${division} ${lp} LP (${wins}W ${losses}L)`.trim();
}

function rankScore(entry) {
  if (!entry) {
    return { tierIndex: TIER_ORDER.length - 1, divisionScore: 0, lp: 0 };
  }
  const tierIndex = TIER_ORDER.indexOf(entry.tier || "UNRANKED");
  const divisionMap = { I: 4, II: 3, III: 2, IV: 1 };
  const divisionScore = divisionMap[entry.rank] || 0;
  return { tierIndex, divisionScore, lp: entry.leaguePoints ?? 0 };
}

function sortLeaderboard(results) {
  results.sort((a, b) => {
    const scoreA = rankScore(a.rankEntry);
    const scoreB = rankScore(b.rankEntry);

    if (scoreA.tierIndex !== scoreB.tierIndex) {
      return scoreA.tierIndex - scoreB.tierIndex;
    }
    if (scoreA.divisionScore !== scoreB.divisionScore) {
      return scoreB.divisionScore - scoreA.divisionScore;
    }
    return scoreB.lp - scoreA.lp;
  });
  return results;
}

function formatLeaderboard(results) {
  if (!results.length) {
    return "No registered players yet.";
  }
  const lines = results.map((result, index) => {
    const rankText = result.error ? `Error: ${result.error}` : buildRankDisplay(result.rankEntry);
    const riotLabel = `${result.riotId} (${result.region})`;
    const place = PLACE_EMOJI[index] || `#${index + 1}`;
    return `${place} ${result.displayName} - ${riotLabel} - ${rankText}`;
  });
  return `**TFT Leaderboard**\n${lines.join("\n")}`;
}

module.exports = {
  buildRankDisplay,
  formatLeaderboard,
  sortLeaderboard
};

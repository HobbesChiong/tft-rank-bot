from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# TODO: tune constants
MAX_LEADERBOARD_ENTRIES = 20
UNRANKED_LABEL = "Unranked"
TOP4_PERCENT_MULTIPLIER = 100

TIER_ORDER = {
    "CHALLENGER": 9,
    "GRANDMASTER": 8,
    "MASTER": 7,
    "DIAMOND": 6,
    "EMERALD": 5,
    "PLATINUM": 4,
    "GOLD": 3,
    "SILVER": 2,
    "BRONZE": 1,
    "IRON": 0,
}

DIVISION_ORDER = {"I": 4, "II": 3, "III": 2, "IV": 1}


def formatTierLabel(rankData: Optional[Dict[str, Any]]) -> str:
    if not rankData:
        return UNRANKED_LABEL
    tier = str(rankData.get("tier", "")).title()
    division = str(rankData.get("rank", "")).upper()
    if division and division in DIVISION_ORDER:
        return f"{tier} {division}"
    return tier


def rankSortKey(rankData: Optional[Dict[str, Any]]) -> Tuple[int, int, int]:
    if not rankData:
        return (0, 0, 0)
    tier = str(rankData.get("tier", "")).upper()
    division = str(rankData.get("rank", "")).upper()
    leaguePoints = int(rankData.get("leaguePoints", 0))
    tierScore = TIER_ORDER.get(tier, 0)
    divisionScore = DIVISION_ORDER.get(division, 0)
    return (tierScore, divisionScore, leaguePoints)


def buildLeaderboardMessage(guildName: str, rows: List[Dict[str, Any]]) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    header = f"TFT Leaderboard - {guildName}"
    lines = [header, f"Updated: {timestamp}", ""]
    lines.append("#  Player               Tier           LP   W/L     AvgPlc  Top4%")

    for index, row in enumerate(rows[:MAX_LEADERBOARD_ENTRIES], start=1):
        rankData = row.get("rank")
        tierLabel = formatTierLabel(rankData)
        leaguePoints = str(rankData.get("leaguePoints", "-")) if rankData else "-"
        wins = str(rankData.get("wins", "-")) if rankData else "-"
        losses = str(rankData.get("losses", "-")) if rankData else "-"
        avgPlacement = row.get("avgPlacement")
        top4Rate = row.get("top4Rate")
        avgPlacementLabel = f"{avgPlacement:.2f}" if isinstance(avgPlacement, float) else "-"
        top4Label = (
            f"{top4Rate * TOP4_PERCENT_MULTIPLIER:.0f}%" if isinstance(top4Rate, float) else "-"
        )
        playerName = row.get("playerName", "Unknown")
        lines.append(
            f"{index:>2} {playerName:<20.20} {tierLabel:<14.14} {leaguePoints:>4} {wins}/{losses:<5}"
            f" {avgPlacementLabel:>6} {top4Label:>6}"
        )

    content = "\n".join(lines)
    return f"```\n{content}\n```"

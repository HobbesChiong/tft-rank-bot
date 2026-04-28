from dataclasses import dataclass
import os
from dotenv import load_dotenv

# TODO: tune constants
DEFAULT_INTERVAL_HOURS = 6
DEFAULT_PLATFORM_REGION = "na1"
DEFAULT_MATCH_REGION = "americas"
DEFAULT_MATCH_COUNT = 20
SECONDS_PER_HOUR = 3600


@dataclass
class Config:
    discordToken: str
    riotApiKey: str
    platformRegion: str
    matchRegion: str
    defaultIntervalHours: int
    matchCount: int


def loadConfig() -> Config:
    load_dotenv()

    discordToken = os.getenv("DISCORD_TOKEN", "").strip()
    riotApiKey = os.getenv("RIOT_API_KEY", "").strip()

    if not discordToken:
        raise ValueError("DISCORD_TOKEN is required")
    if not riotApiKey:
        raise ValueError("RIOT_API_KEY is required")

    platformRegion = os.getenv("DEFAULT_REGION", DEFAULT_PLATFORM_REGION).strip()
    matchRegion = os.getenv("DEFAULT_MATCH_REGION", DEFAULT_MATCH_REGION).strip()
    defaultIntervalHours = int(os.getenv("DEFAULT_INTERVAL_HOURS", str(DEFAULT_INTERVAL_HOURS)))
    matchCount = int(os.getenv("DEFAULT_MATCH_COUNT", str(DEFAULT_MATCH_COUNT)))

    return Config(
        discordToken=discordToken,
        riotApiKey=riotApiKey,
        platformRegion=platformRegion,
        matchRegion=matchRegion,
        defaultIntervalHours=defaultIntervalHours,
        matchCount=matchCount,
    )

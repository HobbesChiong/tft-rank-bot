import asyncio
from urllib.parse import quote
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

# TODO: tune constants
REQUEST_TIMEOUT_SECONDS = 20
MATCH_FETCH_CONCURRENCY = 5
TOP4_MAX_PLACEMENT = 4


class RiotApiError(Exception):
    pass


class RateLimitError(RiotApiError):
    def __init__(self, retryAfterSeconds: int) -> None:
        super().__init__("Riot API rate limit exceeded")
        self.retryAfterSeconds = retryAfterSeconds


@dataclass
class MatchStats:
    avgPlacement: Optional[float]
    top4Rate: Optional[float]


class RiotApi:
    def __init__(self, apiKey: str, platformRegion: str, matchRegion: str, matchCount: int) -> None:
        self.apiKey = apiKey
        self.platformRegion = platformRegion
        self.matchRegion = matchRegion
        self.matchCount = matchCount
        timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS)
        self.session = aiohttp.ClientSession(timeout=timeout)

    async def close(self) -> None:
        await self.session.close()

    def _headers(self) -> Dict[str, str]:
        return {"X-Riot-Token": self.apiKey}

    async def _requestJson(self, url: str) -> Dict[str, Any]:
        async with self.session.get(url, headers=self._headers()) as response:
            if response.status == 429:
                retryAfter = int(response.headers.get("Retry-After", "1"))
                raise RateLimitError(retryAfter)
            if response.status >= 400:
                text = await response.text()
                raise RiotApiError(f"Riot API error {response.status}: {text}")
            return await response.json()

    def splitRiotId(self, riotId: str) -> Tuple[str, str]:
        if "#" not in riotId:
            raise RiotApiError("Riot ID must be in the form Name#Tag")
        gameName, tagLine = riotId.split("#", 1)
        if not gameName or not tagLine:
            raise RiotApiError("Riot ID must include both name and tag")
        return gameName, tagLine

    async def getAccountByRiotId(self, gameName: str, tagLine: str, matchRegion: str) -> Dict[str, Any]:
        encodedName = quote(gameName)
        encodedTag = quote(tagLine)
        url = (
            f"https://{matchRegion}.api.riotgames.com/riot/account/v1/accounts"
            f"/by-riot-id/{encodedName}/{encodedTag}"
        )
        return await self._requestJson(url)

    async def getSummonerByPuuid(self, puuid: str, platformRegion: str) -> Dict[str, Any]:
        url = f"https://{platformRegion}.api.riotgames.com/tft/summoner/v1/summoners/by-puuid/{puuid}"
        return await self._requestJson(url)

    async def getTftEntriesBySummonerId(self, summonerId: str, platformRegion: str) -> List[Dict[str, Any]]:
        url = f"https://{platformRegion}.api.riotgames.com/tft/league/v1/entries/by-summoner/{summonerId}"
        return await self._requestJson(url)

    async def getMatchIds(self, puuid: str, matchRegion: str, matchCount: int) -> List[str]:
        url = (
            f"https://{matchRegion}.api.riotgames.com/tft/match/v1/matches/by-puuid/"
            f"{puuid}/ids?count={matchCount}"
        )
        return await self._requestJson(url)

    async def getMatch(self, matchId: str, matchRegion: str) -> Dict[str, Any]:
        url = f"https://{matchRegion}.api.riotgames.com/tft/match/v1/matches/{matchId}"
        return await self._requestJson(url)

    async def fetchMatchStats(self, puuid: str, matchRegion: str, matchCount: int) -> MatchStats:
        if matchCount <= 0:
            return MatchStats(avgPlacement=None, top4Rate=None)

        matchIds = await self.getMatchIds(puuid, matchRegion, matchCount)
        if not matchIds:
            return MatchStats(avgPlacement=None, top4Rate=None)

        semaphore = asyncio.Semaphore(MATCH_FETCH_CONCURRENCY)

        async def fetchMatch(matchId: str) -> Dict[str, Any]:
            async with semaphore:
                return await self.getMatch(matchId, matchRegion)

        matches = await asyncio.gather(*[fetchMatch(matchId) for matchId in matchIds])
        placements: List[int] = []
        top4Count = 0

        for match in matches:
            participants = match.get("info", {}).get("participants", [])
            for participant in participants:
                if participant.get("puuid") == puuid:
                    placement = int(participant.get("placement", 0))
                    if placement > 0:
                        placements.append(placement)
                        if placement <= TOP4_MAX_PLACEMENT:
                            top4Count += 1
                    break

        if not placements:
            return MatchStats(avgPlacement=None, top4Rate=None)

        avgPlacement = sum(placements) / len(placements)
        top4Rate = top4Count / len(placements)
        return MatchStats(avgPlacement=avgPlacement, top4Rate=top4Rate)

    async def fetchTftProfile(self, riotId: str) -> Dict[str, Any]:
        gameName, tagLine = self.splitRiotId(riotId)
        account = await self.getAccountByRiotId(gameName, tagLine, self.matchRegion)
        puuid = account.get("puuid")
        if not puuid:
            raise RiotApiError("Unable to resolve Riot ID")

        summoner = await self.getSummonerByPuuid(puuid, self.platformRegion)
        summonerId = summoner.get("id")
        if not summonerId:
            raise RiotApiError("Unable to resolve summoner")

        entries = await self.getTftEntriesBySummonerId(summonerId, self.platformRegion)
        rankedEntry = None
        for entry in entries:
            if entry.get("queueType") == "RANKED_TFT":
                rankedEntry = entry
                break

        matchStats = await self.fetchMatchStats(puuid, self.matchRegion, self.matchCount)

        return {
            "riotId": riotId,
            "puuid": puuid,
            "summonerId": summonerId,
            "rank": rankedEntry,
            "avgPlacement": matchStats.avgPlacement,
            "top4Rate": matchStats.top4Rate,
        }

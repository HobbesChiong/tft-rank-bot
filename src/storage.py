import asyncio
import json
import os
from copy import deepcopy
from typing import Any, Dict, Optional

# TODO: tune constants
DEFAULT_DATA: Dict[str, Any] = {"guilds": {}}
UTF8_ENCODING = "utf-8"


class JsonStorage:
    def __init__(self, filePath: str, defaultIntervalHours: int, defaultRegion: str) -> None:
        self.filePath = filePath
        self.defaultIntervalHours = defaultIntervalHours
        self.defaultRegion = defaultRegion
        self.lock = asyncio.Lock()

    async def _readData(self) -> Dict[str, Any]:
        if not os.path.exists(self.filePath):
            return deepcopy(DEFAULT_DATA)

        def readFile() -> Dict[str, Any]:
            with open(self.filePath, "r", encoding=UTF8_ENCODING) as handle:
                return json.load(handle)

        return await asyncio.to_thread(readFile)

    async def _writeData(self, data: Dict[str, Any]) -> None:
        os.makedirs(os.path.dirname(self.filePath), exist_ok=True)

        def writeFile() -> None:
            with open(self.filePath, "w", encoding=UTF8_ENCODING) as handle:
                json.dump(data, handle, indent=2, sort_keys=True)

        await asyncio.to_thread(writeFile)

    def _ensureGuild(self, data: Dict[str, Any], guildId: int) -> Dict[str, Any]:
        guilds = data.setdefault("guilds", {})
        guildKey = str(guildId)
        guild = guilds.setdefault(
            guildKey,
            {
                "intervalHours": self.defaultIntervalHours,
                "channelId": None,
                "users": {},
                "region": self.defaultRegion,
            },
        )
        if "intervalHours" not in guild:
            guild["intervalHours"] = self.defaultIntervalHours
        if "channelId" not in guild:
            guild["channelId"] = None
        if "users" not in guild:
            guild["users"] = {}
        if "region" not in guild:
            guild["region"] = self.defaultRegion
        return guild

    async def listGuildIds(self) -> list[int]:
        async with self.lock:
            data = await self._readData()
            guilds = data.get("guilds", {})
            return [int(guildId) for guildId in guilds.keys()]

    async def getGuildSettings(self, guildId: int) -> Dict[str, Any]:
        async with self.lock:
            data = await self._readData()
            guild = self._ensureGuild(data, guildId)
            return deepcopy(guild)

    async def setGuildInterval(self, guildId: int, intervalHours: int) -> None:
        async with self.lock:
            data = await self._readData()
            guild = self._ensureGuild(data, guildId)
            guild["intervalHours"] = intervalHours
            await self._writeData(data)

    async def setGuildChannel(self, guildId: int, channelId: int) -> None:
        async with self.lock:
            data = await self._readData()
            guild = self._ensureGuild(data, guildId)
            guild["channelId"] = channelId
            await self._writeData(data)

    async def listUsers(self, guildId: int) -> Dict[str, Any]:
        async with self.lock:
            data = await self._readData()
            guild = self._ensureGuild(data, guildId)
            return deepcopy(guild.get("users", {}))

    async def setUser(self, guildId: int, userId: int, userData: Dict[str, Any]) -> None:
        async with self.lock:
            data = await self._readData()
            guild = self._ensureGuild(data, guildId)
            guild["users"][str(userId)] = userData
            await self._writeData(data)

    async def removeUser(self, guildId: int, userId: int) -> bool:
        async with self.lock:
            data = await self._readData()
            guild = self._ensureGuild(data, guildId)
            users = guild.get("users", {})
            removed = users.pop(str(userId), None)
            await self._writeData(data)
            return removed is not None

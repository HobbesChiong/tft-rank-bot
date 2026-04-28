import asyncio
from typing import Dict, Optional

from .config import SECONDS_PER_HOUR

# TODO: tune constants
SCHEDULER_STARTUP_DELAY_SECONDS = 5


class LeaderboardScheduler:
    def __init__(self, bot: "TftBot") -> None:
        self.bot = bot
        self.tasks: Dict[int, asyncio.Task] = {}

    async def startAll(self) -> None:
        await asyncio.sleep(SCHEDULER_STARTUP_DELAY_SECONDS)
        guildIds = await self.bot.storage.listGuildIds()
        for guildId in guildIds:
            await self.scheduleGuild(guildId)

    async def scheduleGuild(self, guildId: int) -> None:
        await self.stopGuild(guildId)
        settings = await self.bot.storage.getGuildSettings(guildId)
        intervalHours = int(settings.get("intervalHours", self.bot.config.defaultIntervalHours))
        task = asyncio.create_task(self._runLoop(guildId, intervalHours))
        self.tasks[guildId] = task

    async def stopGuild(self, guildId: int) -> None:
        task = self.tasks.pop(guildId, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def _runLoop(self, guildId: int, intervalHours: int) -> None:
        intervalSeconds = max(intervalHours, 1) * SECONDS_PER_HOUR
        while True:
            await asyncio.sleep(intervalSeconds)
            await self.bot.postLeaderboard(guildId, isScheduled=True)

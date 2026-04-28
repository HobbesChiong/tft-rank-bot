import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import discord
from discord import app_commands
from discord.ext import commands

from .config import Config, SECONDS_PER_HOUR
from .leaderboard import buildLeaderboardMessage, rankSortKey
from .riot_api import RateLimitError, RiotApi, RiotApiError
from .scheduler import LeaderboardScheduler
from .storage import JsonStorage

# TODO: tune constants
DEFAULT_REFRESH_BUFFER_SECONDS = 30


class TftBot(commands.Bot):
    def __init__(self, config: Config, storage: JsonStorage, riotApi: RiotApi) -> None:
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)
        self.config = config
        self.storage = storage
        self.riotApi = riotApi
        self.scheduler = LeaderboardScheduler(self)

    async def setup_hook(self) -> None:
        self._registerCommands()
        await self.scheduler.startAll()
        await self.tree.sync()

    async def close(self) -> None:
        await self.riotApi.close()
        await super().close()

    def _registerCommands(self) -> None:
        @app_commands.command(name="rank", description="Register or update your Riot ID.")
        @app_commands.describe(riotId="Riot ID in the form Name#Tag")
        async def rankCommand(interaction: discord.Interaction, riotId: str) -> None:
            if not interaction.guild_id:
                await interaction.response.send_message("Use this command in a server.", ephemeral=True)
                return

            await interaction.response.defer(thinking=True)

            try:
                profile = await self.riotApi.fetchTftProfile(riotId)
            except RateLimitError as error:
                await interaction.followup.send(
                    f"Rate limited by Riot. Try again in {error.retryAfterSeconds} seconds.",
                    ephemeral=True,
                )
                return
            except RiotApiError as error:
                await interaction.followup.send(str(error), ephemeral=True)
                return

            userData = {
                "riotId": profile["riotId"],
                "puuid": profile["puuid"],
                "summonerId": profile["summonerId"],
                "rank": profile["rank"],
                "avgPlacement": profile["avgPlacement"],
                "top4Rate": profile["top4Rate"],
                "lastFetched": datetime.now(timezone.utc).isoformat(),
            }
            await self.storage.setUser(interaction.guild_id, interaction.user.id, userData)
            await self.storage.setGuildChannel(interaction.guild_id, interaction.channel_id)

            tierLabel = profile["rank"].get("tier") if profile["rank"] else "Unranked"
            await interaction.followup.send(
                f"Saved {riotId}. Current rank: {tierLabel}.",
                ephemeral=True,
            )

        @app_commands.command(name="remove", description="Remove your Riot ID from tracking.")
        async def removeCommand(interaction: discord.Interaction) -> None:
            if not interaction.guild_id:
                await interaction.response.send_message("Use this command in a server.", ephemeral=True)
                return
            removed = await self.storage.removeUser(interaction.guild_id, interaction.user.id)
            if removed:
                await interaction.response.send_message("Removed your Riot ID.", ephemeral=True)
            else:
                await interaction.response.send_message("You are not registered.", ephemeral=True)

        @app_commands.command(name="leaderboard", description="Show the TFT leaderboard.")
        async def leaderboardCommand(interaction: discord.Interaction) -> None:
            if not interaction.guild_id:
                await interaction.response.send_message("Use this command in a server.", ephemeral=True)
                return
            await interaction.response.defer(thinking=True)
            await self.storage.setGuildChannel(interaction.guild_id, interaction.channel_id)
            message = await self.buildLeaderboard(interaction.guild_id, interaction.guild)
            await interaction.followup.send(message)

        @app_commands.command(name="set-interval", description="Set the auto-refresh interval (hours).")
        @app_commands.describe(hours="Number of hours between scheduled updates")
        async def setIntervalCommand(interaction: discord.Interaction, hours: int) -> None:
            if not interaction.guild_id:
                await interaction.response.send_message("Use this command in a server.", ephemeral=True)
                return
            if not interaction.user.guild_permissions.administrator:
                await interaction.response.send_message("Admins only.", ephemeral=True)
                return

            safeHours = max(hours, 1)
            await self.storage.setGuildInterval(interaction.guild_id, safeHours)
            await self.scheduler.scheduleGuild(interaction.guild_id)
            await interaction.response.send_message(
                f"Interval set to {safeHours} hours.",
                ephemeral=True,
            )

        self.tree.add_command(rankCommand)
        self.tree.add_command(removeCommand)
        self.tree.add_command(leaderboardCommand)
        self.tree.add_command(setIntervalCommand)

    async def buildLeaderboard(self, guildId: int, guild: Optional[discord.Guild]) -> str:
        users = await self.storage.listUsers(guildId)
        if not users:
            return "No users registered yet. Use /rank to add your Riot ID."

        settings = await self.storage.getGuildSettings(guildId)
        intervalHours = int(settings.get("intervalHours", self.config.defaultIntervalHours))
        intervalSeconds = intervalHours * SECONDS_PER_HOUR

        rows = []
        for userId, userData in users.items():
            refreshedData = await self._refreshUserIfNeeded(
                guildId, userId, userData, intervalSeconds
            )
            playerName = self._resolvePlayerName(guild, int(userId))
            rows.append(
                {
                    "playerName": playerName,
                    "rank": refreshedData.get("rank"),
                    "avgPlacement": refreshedData.get("avgPlacement"),
                    "top4Rate": refreshedData.get("top4Rate"),
                }
            )

        rows.sort(key=lambda row: rankSortKey(row.get("rank")), reverse=True)
        guildName = guild.name if guild else "Server"
        return buildLeaderboardMessage(guildName, rows)

    async def _refreshUserIfNeeded(
        self, guildId: int, userId: str, userData: Dict[str, Any], intervalSeconds: int
    ) -> Dict[str, Any]:
        lastFetchedRaw = userData.get("lastFetched")
        needsRefresh = True
        if lastFetchedRaw:
            try:
                lastFetched = datetime.fromisoformat(lastFetchedRaw)
                ageSeconds = (datetime.now(timezone.utc) - lastFetched).total_seconds()
                needsRefresh = ageSeconds >= max(intervalSeconds - DEFAULT_REFRESH_BUFFER_SECONDS, 0)
            except ValueError:
                needsRefresh = True

        if not needsRefresh:
            return userData

        try:
            profile = await self.riotApi.fetchTftProfile(userData["riotId"])
        except RiotApiError:
            return userData

        updatedData = {
            **userData,
            "rank": profile["rank"],
            "avgPlacement": profile["avgPlacement"],
            "top4Rate": profile["top4Rate"],
            "lastFetched": datetime.now(timezone.utc).isoformat(),
        }
        await self.storage.setUser(guildId, int(userId), updatedData)
        return updatedData

    def _resolvePlayerName(self, guild: Optional[discord.Guild], userId: int) -> str:
        if not guild:
            return str(userId)
        member = guild.get_member(userId)
        if not member:
            return str(userId)
        return member.display_name

    async def postLeaderboard(self, guildId: int, isScheduled: bool = False) -> None:
        settings = await self.storage.getGuildSettings(guildId)
        channelId = settings.get("channelId")
        if not channelId:
            return
        channel = self.get_channel(int(channelId))
        if not isinstance(channel, discord.TextChannel):
            return
        guild = channel.guild
        message = await self.buildLeaderboard(guildId, guild)
        await channel.send(message)


def runBot(config: Config) -> None:
    storage = JsonStorage(
        filePath=os.path.join(os.getcwd(), "data", "guilds.json"),
        defaultIntervalHours=config.defaultIntervalHours,
        defaultRegion=config.platformRegion,
    )
    riotApi = RiotApi(
        apiKey=config.riotApiKey,
        platformRegion=config.platformRegion,
        matchRegion=config.matchRegion,
        matchCount=config.matchCount,
    )
    bot = TftBot(config, storage, riotApi)
    bot.run(config.discordToken)

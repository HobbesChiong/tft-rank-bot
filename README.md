# TFT Rank Bot

Discord bot that stores Riot IDs and posts a TFT rank leaderboard.

## Setup

1. Install dependencies:
   - npm install
2. Copy env file:
   - copy .env.example .env
3. Fill in your Discord bot token and Riot API key in .env
4. Optional: set DISCORD_GUILD_ID to your server ID for instant slash command updates
5. Start the bot:
   - npm start

## Commands

- /register riot_id:RiotName#TAG
- /leaderboard
- /setchannel
- /unregister

## Notes

- Leaderboard auto-posting runs every SCHEDULE_HOURS. Use /setchannel to pick the channel.
- Regions are platform routing values: NA1, EUW1, EUN1, KR, etc.

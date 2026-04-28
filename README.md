# TFT Rank Bot

Discord bot that stores Riot IDs, posts a TFT leaderboard, and locks the final standings when someone reaches Diamond 4 or higher.

## Setup

1. Install dependencies:
   - `npm install`
2. Copy the env file:
   - `copy .env.example .env`
3. Fill in `.env`:
   - `DISCORD_TOKEN`
   - `RIOT_API_KEY`
   - optional `DISCORD_GUILD_ID` for faster guild-only slash command updates
   - optional `DEFAULT_REGION` (defaults to `NA1`)
   - optional `SCHEDULE_HOURS` for scheduled leaderboard posts
   - optional `DATA_DIR` for where persistent bot data is stored
4. Start the bot:
   - `npm start`

## Commands

- `/register riot_id:RiotName#TAG`
- `/leaderboard`
- `/setchannel` (this will set the channel for automatic leaderboard posting every SCHEDULE_HOURS)
- `/unregister riot_id:RiotName#TAG`

## Leaderboard Behavior

- `/leaderboard` normally pulls live TFT ranks from Riot.
- The bottom player uses the dog food emoji.
- The bot checks once per hour for a winner.
- If any registered player reaches `DIAMOND IV` or higher, the bot:
  - announces the winner in the channel set by `/setchannel`
  - freezes the leaderboard using the ranks, wins, and losses at that moment
  - changes the header to `Ranks Locked at {Vancouver time}`
- The same winner check also runs when someone uses `/leaderboard`, so the cup still locks even if the hourly check has not run yet.

## Persistent Data

The bot stores its data inside `DATA_DIR`.

By default this is:

- `./data/config.json`
- `./data/registrations.json`

`config.json` stores:

- the channel set by `/setchannel`
- the locked leaderboard snapshot
- the winner and lock timestamp

`registrations.json` stores:

- registered Riot IDs
- their region
- their PUUID

## Railway Deployment

For Railway, use a Volume so data survives restarts and redeploys.

1. Add a Volume to the service.
2. Mount it at `/data`.
3. Set:
   - `DATA_DIR=/data`

With that setup, Railway will persist:

- `/data/config.json`
- `/data/registrations.json`

## Notes

- Use `/setchannel` before expecting scheduled posts or winner announcements.
- Region defaults to `NA1`.
- The leaderboard display includes rank, LP, wins, and losses.

# TFT Rank Bot

A Discord bot that tracks Teamfight Tactics ranks from Riot IDs and posts a per-server leaderboard on demand or on a schedule.

## Features
- Register Riot IDs with /rank
- Show leaderboard with /leaderboard
- Remove your entry with /remove
- Set scheduled refresh interval with /set-interval (admin only)
- Includes wins/losses and top-4 rate from recent TFT matches

## Setup
1. Create a Discord bot and copy its token.
2. Create a Riot API key: https://developer.riotgames.com/
3. Copy .env.example to .env and fill in the values.
4. Install dependencies:
   pip install -r requirements.txt
5. Run the bot:
   python run.py

## Configuration
- DEFAULT_REGION: Riot platform region (e.g., na1, euw1)
- DEFAULT_MATCH_REGION: Riot routing region for match APIs (e.g., americas, europe, asia)
- DEFAULT_INTERVAL_HOURS: Scheduled refresh interval per server
- DEFAULT_MATCH_COUNT: Number of recent matches to use for top-4 stats

## Notes
- The bot posts scheduled leaderboards to the last channel where /rank or /leaderboard was used.
- This project uses JSON storage in data/guilds.json.

## Commands
- /rank <riotId#tag>
- /leaderboard
- /remove
- /set-interval <hours>

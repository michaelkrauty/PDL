v0.4.18
- enabled weekly matchup announcement
- !matchups no longer tags users, only the weekly matchup announcement tags users.
- added guild ID variable to config. Must be set for bot to start.

v0.4.17
- added !matchups
- !top -1 shows all competing players
- removed references to glicko2

v0.4.16
- fixed bug in !top where the int in the string "Top x players:" would be incorrect
- fixed bug in !top where specifying the number of top players to retrieve would retrieve less than expected due to not enough provisional matches played

v0.4.15
- added changelog
- commands are no longer case sensitive
- moved admin help from !help to "!admin help"
- "!admin top" is now just !top
- reworked !top, now lists top 100 players
v2.0.0
- added !register
- added !teamcolor

v1.0.2
- remove challengeme role on quit

v1.0.1
- remove competitor role on quit

v1.0.0
- bot is complete

v0.4.30
- fixed bug in !elo concerning the top 2 players using the command

v0.4.29
- fixed !elo showing incorrect rank in some cases

v0.4.28
- weekly elo decay message now tags users

v0.4.27
- added n week inactivity auto-quit
- added n-1 week inactivity auto-quit warning
- added !admin warn #channel

v0.4.26
- !matchups now tags the command sender
- add !challenging @user
- add !admin say

v0.4.25
- fixed incredibly strange bug where message.guild was undefined

v0.4.24
- add !admin generatematchups, to generate matchups on command
- add !admin avg alias !admin average

v0.4.23
- users who leave the discord server will be retired from the standings and their elo will be set to average if above average
- added !competing @user

v0.4.22
- added !challenging command to show if the sender is challenging or not

v0.4.21
- nicknames will now be used where possible
- removed unused command aliases
- updated help/admin help dialogue
- admin channel commands no longer show channel id
- bot no longer shows version in name by default
- updated !matches strings, added a string to strings.js

v0.4.20
- fixed bug in !elo showing (/6) matches instead of (0/6) matches
- fixed bug in !confirm preventing matches from being confirmed

v0.4.19
- generated weekly matchups are now stored in the database
- !matchups does not generate matchups, instead it gets the generated matchups for that week from the database.

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

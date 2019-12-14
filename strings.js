const strings = {
	welcome_message: '**Welcome** {user_tag}**!**\n-\nPDL is an open challenge league, so you play whenever you want against whoever. You get three challenges a week that follow the format in #current-format.\nRules are linked in #rules\n-\nEvery player has an ELO Rating. There are various tournaments available throughout the year based on your ELO rating. When you fight another player you exchange rating points depending on win/loss. The larger the gap in rating between the players, the more points exchanged in an upset and the less exchanged in a predicted outcome. PDL uses a standard ELO calculation, K=50, with the following modifications: All players gain 5 points (post-calculation) for every match played regardless of outcome. Any player that does not complete a minimum of 1 game in a week suffers a 25 point rating decay. No player will show in overall rankings until they have completed a minimum of 3 matches (6 games).\n-\n**You can register to compete for FREE by using !compete in this channel.**\n-\nUse !help to learn how to submit matches, check ratings, and more.',
	help: '{user}\n__**Help:**__\nUse: **!compete** to register with the bot. Then you can use **!challengeme** to opt into the public ping. To find a game use **@challengeme** to ping folks looking to play.\nYou are allowed 6 challenge matches each week. Use **!submit** to submit scores. The winner submits!\n**Use !basics and !rules for more info.**\n\n__**Full List of Commands**__:\n**!help**: Show this help\n**!rules**: Show 1v1 rules\n**!basics**: Show 1v1 basics\n**!compete**: Start competing in PDL\n**!submit <user>**: Submit a match result\n**!matches**: Show recent matches\n**!confirm**: Confirm pending matches\n**!rank**: Show player rating and closest competitors\n**!top**: Show top rated players\n**!challengeme**: Toggle challengeme role\n**!challenging [user]**: Check if a player is accepting challenges\n**!matchups**: Show suggested weekly matchups\n**!quit**: Stop competing in the 1v1 league (ELO will be reset if above the community average)',
	admin_help: '**[ Admin help ]**\n**!admin help**: Show this help\n**!admin [init|deinit|channels]**: Manage bot channels\n**!admin [confirm|cancel|nullify|info] <game_id>**: Manage matches\n**!admin avg**: Show average ELO\n**!admin say #<channel> <message>**: Bot message\n**!admin warn #<channel>**: Warn inactive users of auto-quit next week\n**!debug [user]**: Show player debug info\n**!registered [user]**: Check if player is registered\n**!competing [user]**: Check if player is competing\n**!version**: Check bot version',
	rules: '{user} Rules:\n1. Be nice\n2. Don\'t cheat',
	basics: '{user} Use !help for help.',
	init_already_using_channel: '{user} already using channel {channel_id}:{channel_name}',
	init_success: '{user} success, using channels:\n{channels}',
	channels_list: '{user}\n{channels}',
	deinit_not_using_channel: '{user} currently not using channel {channel_id}:{channel_name}',
	deinit_success: '{user} success, using channels:\n{channels}',
	user_is_registered: '{user} is registered in the Pavlov Duel League.',
	user_is_not_registered: '{user} is not registered in the Pavlov Duel League.',
	error_not_registered: '{user} you are not registered in PDL. Use !compete to start competing, or !help for help.',
	error_target_not_registered: '{user} {target} is not registered in the Pavlov Duel League.',
	user_is_competing: '{user} is competing in PDL.',
	user_is_not_competing: '{user} is not competing in PDL.',
	target_is_competing: '{user} {target} is competing in PDL.',
	error_user_not_competing: '{user} you are not competing in PDL! Start competing with !compete.',
	error_user_not_competing_other: '{user} {target} is not competing in PDL!',
	target_is_not_competing: '{user} {target} is not competing in PDL.',
	user_now_competing: '{user} is now competing!\nThis is an open challenge 1v1 league; play whenever you want against whoever you want. You get six challenges a week.\nRules are pinned in this channel.\n-\nYou can set your role, check ratings and report matches using <#648255711452856321>\n-\n**Use !help, !basics, and !rules for more info.**',
	compete_already_competing: '{user} you are already competing in PDL.',
	quit_not_competing: '{user} not competing. Compete with !compete',
	user_no_longer_competing: '{user} is no longer competing in PDL!',
	competing_no_user_specified: '{user} usage: !competing @<user>',
	target_is_registered: '{user} {target} is registered in the Pavlov Duel League.',
	compete_try_again: '{user} Usage: !compete',
	user_skill_rating: '{user}(#{elo_rank}) skill rating: {elo_rating}',
	target_skill_rating: '{user} {target}(#{elo_rank}) skill rating: {elo_rating}',
	did_you_win: '{user} did you win your game vs {target}? (yes/no/cancel)',
	match_submit_cancel: '{user} cancelled match submission.',
	match_submit_timeout: '{user} !submit timed out, please try again.',
	match_confirm_timeout: '{user} !confirm timed out, please try again.',
	pending_submitter_was_user: 'Game {match_id}: {user} **{winloss}** vs **{opponent_name}**\n',
	pending_submitter_was_not_user: 'Game {match_id}: **{opponent_name}** **{winloss}** vs {user}\n',
	pending_submit_timeout: '{user} !confirm timed out, please try again.',
	pending_no_user_specified: '{user} Usage: !confirm [@user]',
	pending_dispute: '{user} disputes game {match_id} vs {opponent} {admin}',
	pending_confirm: '{user} confirmed game {match_id}\n{new_elo_message}',
	cancel_match_cancel: '{user} cancelled game {match_id}\n{new_elo_message}',
	pending_waiting_for_input: '{user} thumbs up to confirm, thumbs down to dispute, X to cancel.',
	pending_other_user: 'Game {match_id}: **{opponent_name}** **{winloss}** vs **{player_name}** (Game {match_id})\n',
	matches_dialogue: '{user} recent matches ({num_matches}/{num_max_matches}):\n',
	matches_dialogue_other: '{user}\n{target}\'s matches ({num_matches}/{num_max_matches}):\n',
	matches_unconfirmed: '------Unconfirmed------\n',
	matches_confirmed: '------Confirmed------\n',
	matches_submitter_was_user: '{match_id}: {player_name} **{winloss}** vs **{opponent_name}**\n',
	matches_submitter_was_not_user: '{match_id}: **{opponent_name}** **{winloss}** vs {player_name}\n',
	matches_no_recent_matches: '{user} no recent matches.',
	submit_no_user_specified: '{user} usage: !submit @<user>',
	matches_no_user_specified: '{user} usage: !matches',
	max_weekly_matches_played: '{user} you have recorded the maximum number of matches for the week ({maximum_weekly_challenges}). Match limit reset on Monday at 12am EST.',
	max_weekly_matches_played_other: '{mention_name} has already reached the maximum number of matches for the week ({maximum_weekly_challenges}). Match limit reset on Monday at 12am PST.',
	match_not_found: 'No match found with ID {match_id}',
	confirm_no_user_specified: '{user} usage: !confirm @<user>',
	check_no_user_specified: '{user} usage: !registered @<user>',
	confirm_game_please: '{target} use !confirm to confirm your match.',
	new_elo_message: '----------**Game {match_id}**----------\n**{player_name}** __{winloss}__ vs. **{opponent_name}**\n#{player_elo_rank} {player} ELO: {old_player_elo}->{new_player_elo}\n#{opponent_elo_rank} {opponent} ELO: {old_opponent_elo}->{new_opponent_elo}\n-------------------------------------',
	no_recent_match: '{user} no recent match to confirm.',
	no_unconfirmed_matches: '{user} no unconfirmed matches found for {target}.',
	recent_match_confirmed: '{user} you have already confirmed your latest game.',
	match_already_submitted: '{user} you have already submitted your latest game. Waiting for {target} to confirm.',
	match_already_submitted_by_other_user: '{user} {target} has already submitted your match. Use !confirm to confirm.',
	top_players: 'Top {number} players:\n{top_players}',
	no_top_players: '{user} no players to show.',
	not_enough_provisional_matches_played: '{user} you have not played enough matches to show your ELO rating yet. ({num_games_played}/{provisional_matches})',
	weekly_challenge_reset: '-------------------------------------\n**Weekly Challenges Reset**\n-------------------------------------\nMaximum challenges allowed per week: {matchlimit}',
	weekly_elo_decay: 'The following players\' ratings were decayed for not completing a match last week:\n{players}',
	auto_quit_warning_message: 'The following players have not completed a match within {weeks} weeks and will be auto-quit next week if one or more match is not played:',
	auto_quit_message: 'The following players were auto-quit due to being inactive for {weeks} weeks:',
	user_is_accepting_challenges: '{user} is currently accepting challenges.',
	user_is_not_accepting_challenges: '{user} is not currently accepting challenges.',
	user_is_accepting_challenges_other: '{user} {target} is currently accepting challenges.',
	user_is_not_accepting_challenges_other: '{user} {target} is not currently accepting challenges.',
	challenging_no_user_specified: '{user} usage: !challenging @<user>',
	suggested_matchups_message: '**__Suggested matchups for this week:__**\n',
	suggested_matchups_playerlist_tag: '{player1} vs. {player2}\n',
	suggested_matchups_playerlist: '`{player1} vs. {player2}`\n',
	error_one_command_at_a_time: '{user} only one command can be run at a time.',
	generic_error: '{user} something went wrong, an admin has been notified.'
}
module.exports = strings;
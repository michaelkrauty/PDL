const strings = {
	help: '{user}\n__**Basics**__:\nUse: **!compete** to register with the bot. Then you can use **!challengeme** or **!questme** to set the appropriate role and opt into the public ping. To find a game use **@challengeme** or **@questme** (without the space) to ping folks looking to play.\n\nYou are allowed 3 challenge matches each week. Use **!submit** to submit scores. The winner submits!\n\n__**Full List of Commands**__:\n(__Syntax: <> = required, [] = optional__)\n**!help**: Show this help\n**!compete**: Compete in PDL\n**!submit <user>**: Submit a match result\n**!pending [user]**: Check pending matches\n**!matches**: Show recent matches\n**!elo**: Show player rating and closest competitors\n**!top**: Show top rated players\n**!challengeme**: Toggle challengeme role\n**!questme**: Toggle questme role**\n!quit**: Stop competing in PDL (if your rating is above average it will reset to average, if it is below average it will be locked there in case you come back)  (WARNING: No Confirmation. Do not quit unless you are sure.)',
	admin_help: '**!init**: Let the bot use a channel\n**!deinit**: Make the bot stop using a channel\n**!channels**: See channels in use\n**!debug [user]**: Show player stats\n**!check [user]**: Check if player is registered\n**!competing [user]**: Check if player is competing\n**!version**: Check bot version',
	init_already_using_channel: '{user} already using channel {channel_id}:{channel_name}',
	init_success: '{user} success, using channels:\n{channels}',
	channels_list: '{user}\n{channels}',
	deinit_not_using_channel: '{user} currently not using channel {channel_id}:{channel_name}',
	deinit_success: '{user} success, using channels:\n{channels}',
	user_is_registered: '{user} is registered in the Pavlov Duel League.',
	user_is_not_registered: '{user} is not registered in the Pavlov Duel League.',
	error_not_registered: '{user} you are not registered in PDL. Use !compete to start competing, or !help for help.',
	error_target_not_registered: '{user} {target} is not registered in the Pavlov Duel League.',
	user_is_competing: '{user} is competing.',
	user_is_not_competing: '{user} is not competing.',
	error_user_not_competing: '{user} you are not competing in PDL! Start competing with !compete.',
	target_is_not_competing: '{user} {target} is not competing in PDL.',
	user_now_competing: '{user} is now competing in PDL!',
	compete_already_competing: '{user} you are already competing in PDL.',
	quit_not_competing: '{user} not competing. Compete with !compete',
	user_no_longer_competing: '{user} is no longer competing in PDL!',
	target_is_registered: '{user} {target} is registered in the Pavlov Duel League.',
	compete_try_again: '{user} Usage: !compete',
	user_skill_rating: '{user}(#{user_rank}) skill rating: {skill_rating}.',
	target_skill_rating: '{user} {target}\'s skill rating: {elo}.',
	did_you_win: '{user} did you win your game vs {target}?',
	match_submit_timeout: '{user} !submit timed out, please try again.',
	pending_submitter_was_user: 'Game {match_id}: {user} **{winloss}** vs **{opponent_name}**\n',
	pending_submitter_was_not_user: 'Game {match_id}: **{opponent_name}** **{winloss}** vs {user}\n',
	pending_submit_timeout: '{user} !pending timed out, please try again.',
	pending_no_user_specified: '{user} Usage: !pending [@user]',
	pending_dispute: '{user} disputes game {match_id} vs {opponent} {admin}',
	pending_confirm: '{user} confirmed game {match_id}\n{new_elo_message}',
	cancel_match_cancel: '{user} cancelled game {match_id}\n{new_elo_message}',
	pending_waiting_for_input: '{user} thumbs up to confirm, thumbs down to dispute.',
	pending_other_user: 'Game {match_id}: **{opponent_name}** **{winloss}** vs **{player_name}** (Game {match_id})\n',
	matches_submitter_was_user: '{match_id}: {user} {winloss} vs **{opponent_name}**\n',
	matches_submitter_was_not_user: '{match_id}: **{opponent_name}** {winloss} vs {user}\n',
	submit_no_user_specified: '{user} please specifiy a user by tagging them (!submit @<user>).',
	max_weekly_matches_played: '{user} you have recorded the maximum number of matches for the week ({maximum_weekly_challenges}). Match limit reset on Monday at 12am PST.',
	max_weekly_matches_played_other: '{mention_name} has already reached the maximum number of matches for the week ({maximum_weekly_challenges}). Match limit reset on Monday at 12am PST.',
	match_not_found: 'No match found with ID {match_id}',
	confirm_no_user_specified: '{user} please specifiy a user by tagging them (!confirm @<user>).',
	check_no_user_specified: '{user} please specifiy a user by tagging them (!check @<user>).',
	confirm_game_please: '{target} use !pending to confirm your match.',
	new_elo_message: '----------**Game {match_id}**----------\n**{player_name}** __{winloss}__ vs. **{opponent_name}**\n#{player_elo_rank} {player} ELO: {old_player_elo}->{new_player_elo}\n#{opponent_elo_rank} {opponent} ELO: {old_opponent_elo}->{new_opponent_elo}\n-------------------------------------',
	no_recent_match: '{user} no recent match to confirm.',
	no_unconfirmed_matches: '{user} no unconfirmed matches found for {target}.',
	recent_match_confirmed: '{user} you have already confirmed your latest game.',
	match_already_submitted: '{user} you have already submitted your latest game. Waiting for {target} to confirm.',
	match_already_submitted_by_other_user: '{user} {target} has already submitted your match. Use !pending to confirm.',
	top_players: 'Top players:\n```{top_players}```',
	could_not_get_top_players: '{user} could not get top players.',
	generic_error: '{user} something went wrong, an admin has been notified.'
}
module.exports = strings;
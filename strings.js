const strings = {
	help: '{user}\n__**Basics**__:\nUse: **!compete** to register with the bot. Then you can use **!challengeme** or **!questme** to set the appropriate role and opt into the public ping. To find a game use **@challengeme** or **@questme** (without the space) to ping folks looking to play.\n\nYou are allowed 3 challenge matches each week. Use **!submit** to submit scores. The winner submits!\n\n__**Full List of Commands**__:\n(__Syntax: <> = required, [] = optional__)\n**!help**: Show this help\n**!compete**: Compete in PDL\n**!submit <user>**: Submit a match result\n**!pending [user]**: Check pending matches\n**!elo**: Show player rating and closest competitors\n**!top**: Show top rated players\n**!quit**: Stop competing in PDL (if your rating is above average it will reset to average, if it is below average it will be locked there in case you come back)  (WARNING: No Confirmation. Do not quit unless you are sure.)',
	admin_help: '**!init**: Let the bot use a channel\n**!deinit**: Make the bot stop using a channel\n**!channels**: See channels in use\n**!debug [user]**: Show player stats\n**!check [user]**: Check if player is registered\n**!version**: Check bot version',
	user_is_registered: '{user} is registered in the Pavlov Duel League.',
	user_is_not_registered: '{user} is not registered in the Pavlov Duel League.',
	error_not_registered: '{user} you are not registered in PDL. Use !compete to start competing, or !help for help.',
	error_target_not_registered: '{user} {target} is not registered in the Pavlov Duel League.',
	user_is_competing: '{user} is competing.',
	user_is_not_competing: '{user} is not competing.',
	error_user_not_competing: '{user} you are not competing in PDL! Start competing with !compete.',
	target_is_not_competing: '{user} {target} is not competing in PDL.',
	user_now_competing: '{user} is now competing in PDL!',
	user_no_longer_competing: '{user} is no longer competing in PDL!',
	target_is_registered: '{user} {target} is registered in the Pavlov Duel League.',
	compete_try_again: '{user} Usage: !compete',
	user_skill_rating: '{user}(#{user_rank}) skill rating: {skill_rating}.',
	target_skill_rating: '{user} {target}\'s skill rating is {elo}.',
	did_you_win: '{user} did you win your game vs {target}?',
	match_submit_timeout: '{user} timed out, please !submit again.',
	pending_submit_timeout: '{user} timed out, please use !pending again.',
	submit_no_user_specified: '{user} please specifiy a user by tagging them (!submit @<user>).',
	confirm_no_user_specified: '{user} please specifiy a user by tagging them (!confirm @<user>).',
	check_no_user_specified: '{user} please specifiy a user by tagging them (!check @<user>).',
	confirmations_no_user_specified: '{user} Usage: !confirm, or !confirm @<user>, to check pending confirmations.',
	pending_no_user_specified: '{user} Usage: !pending [@user]',
	confirm_game_please: '{target} use !pending to confirm your match.',
	new_elo_message: '-----------------------------------------------\n**{user_name}** {winloss} vs. **{target_name}**\n#{user_elo_rank} {user} ELO: {old_user_elo}->{new_user_elo}\n#{target_elo_rank} {target} ELO: {old_target_elo}->{new_target_elo}\n-----------------------------------------------',
	no_recent_match: '{user} no recent match to confirm.',
	no_unconfirmed_matches: '{user} no unconfirmed matches found for {target}.',
	recent_match_confirmed: '{user} you have already confirmed your latest game.',
	match_already_submitted: '{user} you have already submitted your latest game. Waiting for {target} to confirm.',
	match_already_submitted_by_other_user: '{user} {target} has already submitted your match. Use !pending to confirm.',
	could_not_get_top_players : '{user} could not get top players.',
	generic_error: '{user} something went wrong, an admin has been notified.'
}
module.exports = strings;
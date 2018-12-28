const strings = {
	help: '```PDL-bot Commands:\nSyntax: <> = required, [] = optional\n!register: Register in PDL\n!compete: Compete in PDL\n!retire: Stop competing in PDL\n!competing [user]: Check if user is competing\n!check [user]: Check registration in PDL\n!sr [user]: Show skill rating```',
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
	user_elo: '{user} your ELO is {elo}.',
	target_elo: '{user} {target}\'s elo is {elo}.',
	did_you_win: '{user} did you win the game?',
	match_submit_timeout: '{user} timed out, please !submit again.',
	submit_no_user_specified: '{user} please specifiy a user by tagging them (!submit @<user>).',
	confirm_no_user_specified: '{user} please specifiy a user by tagging them (!confirm @<user>).',
	confirmations_no_user_specified: '{user} Usage: !confirm, or !confirm @<user>, to check pending confirmations.',
	pending_no_user_specified: '{user} Usage: !pending, or !pending @<user>, to check pending confirmations.',
	confirm_game_please: '{target} please !confrim the game.',
	new_elo_message: '{user} ELO: {old_user_elo}->{new_user_elo}\n{target} ELO: {old_target_elo}->{new_target_elo}',
	no_recent_match: '{user} no recent match to confirm.',
	no_unconfirmed_matches: '{user} no unconfirmed matches found for {target}.',
	recent_match_confirmed: '{user} you have already confirmed your latest game.',
	match_already_submitted: '{user} you have already submitted your latest game. Waiting for {target} to !confirm.',
	match_already_submitted_by_other_user: '{user} {target} has already submitted your match. Use !confirm @<user> to confirm.',
	generic_error: '{user} something went wrong, an admin has been notified.'
}
module.exports = strings;
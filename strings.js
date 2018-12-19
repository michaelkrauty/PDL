const strings = {
	help: '```PDL-bot Commands:\nSyntax: <> = required paramater, [] = optional paramater\n!register: Register in PDL\n!compete: Compete in PDL\n!retire: Stop competing in PDL\n!competing [user]: Check whether you are currently competing\n!check [user]: Check registration in PDL\n!sr [user]: Get current SR\'s SR```',
	user_is_registered: '{user} is registered in the Pavlov Duel League.',
	user_is_not_registered: '{user} is not registered in the Pavlov Duel League.',
	user_is_now_registered: '{user} is now registered in the Pavlov Duel League!',
	user_is_already_registered: '{user} you are already registered in the Pavlov Duel League!',
	error_not_registered: '{user} you are not registered in PDL. Use !register to register!',
	error_target_not_registered: '{user} {target} is not registered in the Pavlov Duel League.',
	user_is_competing: '{user} is competing.',
	user_is_not_competing: '{user} is not competing.',
	user_now_competing: '{user} is now competing in PDL!',
	user_no_longer_competing: '{user} is no longer competing in PDL!',
	target_is_registered: '{user} {target} is registered in the Pavlov Duel League.',
	target_is_not_registered: '{user} {target} is not registered in the Pavlov Duel League.',
	user_elo: '{user} your ELO is {elo}.',
	did_you_win: '{user} did you win the game?',
	new_elo_message: '{user} ELO: {old_user_elo}->{new_user_elo}\n{target} ELO: {old_target_elo}->{new_target_elo}'
}
module.exports = strings;
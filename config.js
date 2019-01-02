module.exports.config = {
	// rating method (0 = elo, 1 = glicko2 live, 2 = glicko2 schedule)
	rating_method: 0,
	// elo K variable
	elo_k: 50,
	// weekly limit on challenges submitted per user
	maximum_weekly_challenges: 3,
	// bonus elo per game simply for playing
	bonus_elo: 5,
	admin_discord_ids: [89798561553739776, 396793965174718464]
};
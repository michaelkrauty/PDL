module.exports.config = {
	// rating method (0 = elo, 1 = glicko2 live, 2 = glicko2 schedule)
	rating_method: 0,
	// default starting elo
	default_starting_elo: 1200,
	// elo K variable
	elo_k: 50,
	// weekly limit on challenges submitted per user
	maximum_weekly_challenges: 3,
	// bonus elo per game simply for playing
	bonus_elo: 5,
	// number of matches before player shows up in !top and !elo
	provisional_matches: 3,
	// adds the bot version to the bot name on startup
	enable_version_in_bot_name: true
};
module.exports.config = {
	// the ID of the discord server (can be found by enabling developer mode in discord (Settings->Appearance->Developer Mode), right clicking on the discord server, and copying the ID here)
	guild_id: '0',
	// default starting elo
	// NOTE: this value only takes effect for the first user to register.
	default_starting_elo: 1200,
	// elo K variable
	elo_k: 50,
	// weekly limit on challenges submitted per user
	maximum_weekly_challenges: 6,
	// bonus elo per game simply for playing
	bonus_elo: 5,
	// number of matches before player shows up in !top and !elo
	provisional_matches: 6,
	// should inactive users' elo decay on a weekly basis?
	weekly_elo_decay: true,
	// how much should elo decay on a weekly basis?
	weekly_elo_decay_amount: 25,
	// auto-quit users who are inactive for n weeks?
	auto_quit: true,
	// how many weeks does a player have to be inactive to be auto-quit?
	auto_quit_weeks: 6,
	// channel to send auto-quit messages to
	auto_quit_channel: '',
	// how many players should be shown with !top by default?
	top_players: 100,
	// channel to post suggested weekly matchups to. Set to 0 to disable.
	suggested_weekly_matchups_channel: '0',
	// player (admin) to leave out of the weekly recommended matchups in case of an uneven amount of players. Set to 0 to disable.
	suggested_matchups_odd_player_out: '0',
	// adds the bot version to the bot name on startup
	enable_version_in_bot_name: false,
	// channel ID to send wecome message to when a new user joins. Set to 0 to disable.
	welcome_channel: '0',
	// admin role name (case sensitive)
	admin_role_name: 'admin',
	// competior role name (case sensitive) set to '' to disable
	competitor_role_name: 'competitor'
};
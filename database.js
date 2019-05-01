const log = require('winston');
const config = require('./config.js').config;
const config_db = require('./config_db.js').db;
var pool;

/**
 * @description connects to SQL database and creates necessary tables
 */
module.exports.connect = function () {
	return new Promise(async (resolve, reject) => {
		let mysql = await require('mysql');
		// connect to MySQL DB
		log.info(`Connecting to MySQL DB: ${config_db.user}@${config_db.host}...`);
		// create mysql connection pool
		pool = await mysql.createPool({
			host: config_db.host,
			database: config_db.database,
			user: config_db.user,
			password: config_db.password
		});
		log.info('Connected to MySQL DB!');
		resolve();
	});
}

module.exports.checkTables = async () => {
	// create DB tables if they don't already exist
	let defaultElo = 1500;
	if (config.default_starting_elo)
		defaultElo = config.default_starting_elo;
	var usersCreated = await exports.sql('CREATE TABLE IF NOT EXISTS users (id bigint primary key auto_increment, discord_id varchar(255), elo_rating int not null default ?, competing boolean not null default false);', defaultElo);
	if (usersCreated.warningCount === 0)
		log.info(`Created 'users' table`);
	var matchesCreated = await exports.sql('CREATE TABLE IF NOT EXISTS matches (id bigint primary key auto_increment, player_id bigint not null, opponent_id bigint not null, result boolean not null default false, confirmed boolean not null default false, player_start_elo int, player_end_elo int, opponent_start_elo int, opponent_end_elo int, timestamp timestamp not null default current_timestamp);');
	if (matchesCreated.warningCount === 0)
		log.info(`Created 'matches' table`);
	var matchupsCreated = await exports.sql('CREATE TABLE IF NOT EXISTS matchups (id tinyint primary key auto_increment, matchups longtext);');
	if (matchupsCreated.warningCount === 0)
		log.info(`Created 'matchups' table`);
	var channelsCreated = await exports.sql('CREATE TABLE IF NOT EXISTS channels (id bigint primary key auto_increment, channel_id varchar(255), type varchar(255));');
	if (channelsCreated.warningCount === 0)
		log.info(`Created 'channels' table`);
}

/**
 * @description executes an sql query and returns the result
 * @param {string} sql sql string
 * @param {var[]} vars variables
 * @returns SQL query result
 */
module.exports.sql = (sql, vars) => {
	return new Promise((resolve, reject) => {
		pool.getConnection((err, con) => {
			if (err) throw err;
			con.query(sql, vars, (err, res) => {
				con.release();
				if (err) throw err;
				resolve(res);
			});
		});
	});
}

/**
 * @description check if user exists in DB
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, exists: boolean}
 */
module.exports.exists = async (discord_id) => {
	var res = await exports.sql('SELECT id FROM users WHERE discord_id=?;', discord_id);
	return res.length > 0;
}


/**
 * @description check if user exists in DB
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, exists: boolean}
 */
module.exports.checkUserExists = async (discord_id) => {
	var res = await exports.sql('SELECT id FROM users WHERE discord_id=?;', discord_id);
	return res.length > 0;
}


/**
 * @description register new user
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean}
 */
exports.registerUser = async (discord_id) => {
	var exists = await exports.checkUserExists(discord_id);
	if (!exists) {
		var created = await exports.createUserInDB(discord_id);
		return created.length > 0;
	}
	return false;
}

/**
 * @description create new user in DB
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean}
 */
exports.createUserInDB = async (discord_id) => {
	var average_elo = await exports.getAverageCompetingElo();
	if (average_elo == null || average_elo == 0)
		average_elo = config.default_starting_elo;
	var res = await exports.sql(
		'INSERT INTO users (discord_id, elo_rating) VALUES (?,?);', [discord_id, average_elo]);
	return res.length > 0;
}

/**
 * @description check if the user is competing
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, competing: boolean}
 */
exports.isUserCompeting = async (discord_id) => {
	var res = await exports.sql('SELECT competing FROM users WHERE discord_id=?;', discord_id);
	if (res.length > 0)
		return res[0].competing;
	else return false;
}

/**
 * @description set user's competing boolean
 * @param {bigint} discord_id the user's discord id
 * @param {boolean} competing is the user competing?
 * @returns {success: boolean}
 */
exports.setUserCompeting = async (discord_id, competing) => {
	var res = await exports.sql('UPDATE users SET competing=? WHERE discord_id=?;', [competing, discord_id]);
	return res.length != 0;
}

/**
 * @todo
 * @description get all of a user's data
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, userdata[]}
 */
exports.getUserData = async (discord_id) => {
	var res = await exports.sql('SELECT * FROM users WHERE discord_id=?;', discord_id);
	return res[0];
}

/**
 * @todo
 * @description get all of a user's data
 * @param {bigint} user_id the user's user id
 * @returns {success: boolean, userdata[]}
 */
exports.getUserDataUsingId = async (user_id) => {
	var res = await exports.sql('SELECT * FROM users WHERE id=?;', user_id);
	return res[0];
}

/**
 * @description get user's ELO rating
 * @param {bigint} id the user's id
 * @returns {success: boolean, elo_rating: int}
 */
exports.getAverageElo = async () => {
	var res = await exports.sql('SELECT AVG(elo_rating) AS elo_rating FROM users;');
	if (res.length > 0)
		return Math.round(res[0].elo_rating);
	return Math.round(config.default_starting_elo);
}

/**
 * @description get user's ELO rating
 * @param {bigint} id the user's id
 * @returns {success: boolean, elo_rating: int}
 */
exports.getAverageCompetingElo = async () => {
	var res = await exports.sql('SELECT AVG(elo_rating) AS avg FROM users WHERE competing=true;');
	if (res.length > 0)
		return Math.round(res[0].avg);
	return Math.round(config.default_starting_elo);
}

/**
 * @description get players who have not played a match this week
 * @returns {[users]}
 */
exports.getUsersToDecayElo = async () => {
	var res = await exports.sql('SELECT id, discord_id, elo_rating FROM users WHERE elo_rating > 0 AND competing=true;');
	var users = [];
	for (var r in res) {
		// get all user matches to check if the user has 0 matches, in which case their elo is not decayed.
		var allMatches = await exports.getAllUserMatches(res[r].id);
		// get all matches from the previous week
		var previousWeekMatches = await exports.getUserRecentMatches(res[r].id, 1);
		// decay elo if no matches from the previous week, no matches from this week, and >1 game total
		if (!previousWeekMatches && allMatches)
			users.push(res[r]);
	}
	return users;
}

/**
 * @description get user's ELO rating
 * @param {bigint} id the user's id
 * @returns {success: boolean, elo_rating: int}
 */
exports.getUserEloRating = async (user_id) => {
	var res = await exports.sql('SELECT elo_rating FROM users WHERE id=?;', user_id);
	if (res.length > 0)
		return res[0].elo_rating;
	return false;
}

/**
 * @description get user's ELO rating
 * @param {bigint} id the user's id
 * @returns {success: boolean, rank: int}
 */
exports.getUserEloRanking = async (user_id) => {
	var res = await exports.sql('SELECT id, elo_rating, FIND_IN_SET( elo_rating, (SELECT GROUP_CONCAT( DISTINCT elo_rating ORDER BY elo_rating DESC ) FROM users)) AS rank FROM users WHERE id=?;', user_id);
	if (res.length > 0)
		return res[0].rank;
	return false;
}

/**
 * @description set user's ELO ranking
 * @param {int} user_id the user's id
 * @param {int} elo the user's new ELO ranking
 * @returns {success: boolean}
 */
exports.setUserEloRating = async (user_id, elo) => {
	var res = await exports.sql('UPDATE users SET elo_rating=? WHERE id=?;', [elo, user_id]);
	return res.length > 0;
}

/**
 * @description submit a match result
 * @param {int} player_id the player's user id
 * @param {int} opponent_id the opponent's user id
 * @param {int} result the result of the match (0 = loss, 1 = win)
 * @param {int} player_start_elo @default null the user's current elo
 * @param {int} opponent_start_elo @default null the opponent's current elo
 * @param {int} player_end_elo @default null the user's elo after match elo calculation
 * @param {int} opponent_end_elo @default null the opponent's elo after match elo calculation
 * @returns {success: boolean}
 */
exports.submitMatchResult = async (player_id, opponent_id, result, player_start_elo, opponent_start_elo, player_end_elo, opponent_end_elo) => {
	var sql;
	if (player_end_elo == null || opponent_end_elo == null) {
		sql = 'INSERT INTO matches (player_id, opponent_id, result, player_start_elo, opponent_start_elo) VALUES (?,?,?,?,?);';
		vars = [player_id, opponent_id, result, player_start_elo, opponent_start_elo];
	} else {
		sql = 'INSERT INTO matches (player_id, opponent_id, result, player_start_elo, opponent_start_elo, player_end_elo, opponent_end_elo) VALUES (?,?,?,?,?,?,?);';
		vars = [player_id, opponent_id, result, player_start_elo, opponent_start_elo, player_end_elo, opponent_end_elo];
	}
	var res = await exports.sql(sql, vars);
	return res.length > 0;
}

/**
 * @description confirm a match result
 * @param {int} match_id the match to confirm
 * @param {boolean} confirmed is the match confirmed?
 * @returns {success: boolean}
 */
exports.setMatchResultConfirmed = async (match_id, confirmed) => {
	var res = await exports.sql('UPDATE matches SET confirmed=? WHERE id=?;', [confirmed, match_id]);
	return res.length > 0;
}

/**
 * @description confirm a match result
 * @param {int} match_id the match to confirm
 * @param {boolean} confirmed is the match confirmed?
 * @param {int} old_user_elo the user's old elo
 * @param {int} new_user_elo the user's new elo
 * @param {int} old_opponent_elo the opponent's old elo
 * @param {int} new_opponent_elo the opponent's new elo
 * @returns {success: boolean}
 */
exports.updateMatch = async (match_id, confirmed, player_start_elo, player_end_elo, opponent_start_elo, opponent_end_elo) => {
	var res = await exports.sql('UPDATE matches SET confirmed=?, player_start_elo=?, player_end_elo=?, opponent_start_elo=?, opponent_end_elo=? WHERE id=?;', [confirmed, player_start_elo, player_end_elo, opponent_start_elo, opponent_end_elo, match_id]);
	return res.length > 0;
}

/**
 * @description delete a match
 * @param {int} match_id the match to delete
 * @returns {boolean}
 */
exports.deleteMatch = async (match_id) => {
	var res = await exports.sql('DELETE FROM matches WHERE id=?', match_id);
	return res.length > 0;
}

/**
 * @description get user id from Discord id
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, id: bigint}
 */
exports.getUserIdFromDiscordId = async (discord_id) => {
	var res = await exports.sql('SELECT id FROM users WHERE discord_id=?;', discord_id);
	if (res.length > 0)
		return parseInt(res[0].id);
	return false;
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getAllUserMatches = async (user_id) => {
	var res = await exports.sql('SELECT * FROM matches WHERE (player_id=? OR opponent_id=?) ORDER BY id ASC;', [user_id, user_id]);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserUnconfirmedMatches = async (user_id) => {
	var res = await exports.sql('SELECT * FROM matches WHERE (player_id=? OR opponent_id=?) AND confirmed=false ORDER BY id ASC;', [user_id, user_id]);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserLatestMatchVs = async (user_id, target_id) => {
	var res = await exports.sql('SELECT * FROM matches WHERE player_id=? AND opponent_id=? ORDER BY id DESC LIMIT 1;', [user_id, target_id]);
	if (res.length > 0)
		return res[0];
	return false;
}

/**
 * @description get user's latest matches within n weeks ago
 * @param {bigint} user_id the user's id
 * @param {int} weeks amount of weeks back to get matches from (0 = this week, 1 = previous week, etc.)
 * @returns {success: boolean, match: []}
 */
exports.getUserRecentMatches = async (user_id, weeks) => {
	var res = await exports.sql('SELECT * FROM matches WHERE (player_id=? OR opponent_id=?) AND (YEARWEEK(`timestamp`, 1) >= YEARWEEK(CURDATE(), 1) - ?) ORDER BY id ASC;', [user_id, user_id, weeks]);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description get user's latest matches
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserNumConfirmedMatches = async (user_id) => {
	var res = await exports.sql('SELECT id FROM matches WHERE ((player_id=? OR opponent_id=?) AND confirmed=true) ORDER BY id ASC;', [user_id, user_id]);
	if (res.length > 0)
		return res.length;
	return false;
}

/**
 * @description get team's latest matches
 * @param {bigint} teamId the team's id
 * @returns {success: boolean, match: []}
 */
exports.getTeamNumConfirmedMatches = async (format, teamId) => {
	var res = await exports.sql('SELECT id FROM ?? WHERE ((team1=? OR team2=?) AND confirmed=true) ORDER BY id ASC;', ['matches_' + format, teamId, teamId]);
	if (res.length > 0)
		return res.length;
	return false;
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getMatch = async (match_id) => {
	var res = await exports.sql('SELECT * FROM matches WHERE id=?;', match_id);
	if (res.length > 0)
		return res[0];
	return false;
}

/**
 * @description get the top x players on the leaderboard
 * @param {int} amount the amount of top players to retrieve
 * @returns {success: boolean, players: []}
 */
exports.getTopPlayers = async (amount) => {
	var res = await exports.sql('SELECT * FROM users ORDER BY elo_rating DESC LIMIT ?;', amount);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description get the top x players on the leaderboard
 * @param {int} amount the amount of top players to retrieve. If -1, all top competing players will be retrieved.
 * @returns [players] = false
 */
exports.getTopCompetingPlayers = async (amount) => {
	// get top x players by elo rating. If amount is -1, get all top competing players.
	var res;
	if (amount == -1)
		res = await exports.sql('SELECT * FROM users WHERE competing=true ORDER BY elo_rating DESC;');
	else
		res = await exports.sql('SELECT * FROM users WHERE competing=true ORDER BY elo_rating DESC LIMIT ?;', amount);
	// loop through retrieved players and sort out the ones without enough matches
	var players = [];
	for (var i in res) {
		// get number of confirmed matches if amount != -1
		var numMatches = 0;
		if (amount != -1)
			numMatches = await exports.getUserNumConfirmedMatches(res[i].id);
		// only show players with enough provisional matches played if amount != -1
		if (numMatches && numMatches >= config.provisional_matches || amount == -1)
			players.push(res[i]);
	}
	// if the amount of players in the array is less than the requested amount, contine retrieving players
	// if amount is -1, all competing players have already been retrieved.
	if (players.length < amount && amount != -1) {
		var loop = true;
		var offset = amount;
		// loop until we get enough competing users or run out of user entries
		while (loop) {
			// break the loop if we already have the specified amount of players
			if (players.length >= amount) {
				loop = false;
				break;
			}
			// retrieve the next player
			var p = await exports.sql('SELECT * FROM users WHERE competing=true ORDER BY elo_rating DESC LIMIT 1 OFFSET ?;', offset);
			offset++;
			// break the loop if no player was retrieved (we ran out of players)
			// else, check if the retrieved player has completed all provisional matches and add them to the players array if they have
			if (!p || p.length < 1) {
				loop = false;
				break;
			} else {
				// get number of confirmed matches
				var numMatches = await exports.getUserNumConfirmedMatches(p[0].id);
				// only show players with enough provisional matches played
				if (numMatches && numMatches >= config.provisional_matches) {
					players.push(p[0]);
				}
			}
		}
	}
	if (players.length > 0)
		return players;
	return false;
}

/**
 * @description get the top x teams on the leaderboard
 * @param {int} amount the amount of top teams to retrieve. If -1, all top competing teams will be retrieved.
 * @returns [teams], false
 */
exports.getTopCompetingTeams = async (format, amount) => {
	// get top x teams by elo rating. If amount is -1, get all top competing teams.
	var res;
	if (amount == -1)
		if (format === '1v1')
			res = await exports.sql('SELECT * FROM users WHERE competing=true ORDER BY elo_rating DESC;');
		else
			res = await exports.sql('SELECT * FROM ?? WHERE competing=true ORDER BY elo_rating DESC;', 'teams_' + format);
	else
		if (format === '1v1')
			res = await exports.sql('SELECT * FROM users WHERE competing=true ORDER BY elo_rating DESC LIMIT ?;', amount);
		else
			res = await exports.sql('SELECT * FROM ?? WHERE competing=true ORDER BY elo_rating DESC LIMIT ?;', ['teams_' + format, amount]);
	// loop through retrieved teams and sort out the ones without enough matches
	var teams = [];
	for (var i in res) {
		// get number of confirmed matches if amount != -1
		var numMatches = 0;
		if (amount != -1)
			if (format === '1v1')
				numMatches = await exports.getUserNumConfirmedMatches(res[i].id);
			else
				numMatches = await exports.getTeamNumConfirmedMatches(format, res[i].id);
		// only show teams with enough provisional matches played if amount != -1
		if (numMatches && numMatches >= config.provisional_matches || amount == -1)
			teams.push(res[i]);
	}
	// if the amount of teams in the array is less than the requested amount, contine retrieving teams
	// if amount is -1, all competing teams have already been retrieved.
	if (teams.length < amount && amount != -1) {
		var loop = true;
		var offset = amount;
		// loop until we get enough competing users or run out of user entries
		while (loop) {
			// break the loop if we already have the specified amount of teams
			if (teams.length >= amount) {
				loop = false;
				break;
			}
			// retrieve the next player
			if (format === '1v1')
				var p = await exports.sql('SELECT * FROM users WHERE competing=true ORDER BY elo_rating DESC LIMIT 1 OFFSET ?;', offset);
			else
				var p = await exports.sql('SELECT * FROM ?? WHERE competing=true ORDER BY elo_rating DESC LIMIT 1 OFFSET ?;', ['teams_' + format, offset]);
			offset++;
			// break the loop if no player was retrieved (we ran out of teams)
			// else, check if the retrieved player has completed all provisional matches and add them to the teams array if they have
			if (!p || p.length < 1) {
				loop = false;
				break;
			} else {
				// get number of confirmed matches
				if (format === '1v1')
					var numMatches = await exports.getUserNumConfirmedMatches(p[0].id);
				else
					var numMatches = await exports.getTeamNumConfirmedMatches(format, p[0].id);
				// only show teams with enough provisional matches played
				if (numMatches && numMatches >= config.provisional_matches) {
					teams.push(p[0]);
				}
			}
		}
	}
	if (teams.length > 0)
		return teams;
	return false;
}

/**
 * @description get similarly ranked players to the user, amount is how many other users above/below to show
 * @param {int} amount the amount of top players to retrieve
 * @returns {success: boolean, players: []}
 */
exports.getNearbyPlayers = async (user_id, amount) => {
	var res = await exports.sql('SELECT users.id, users.discord_id, users.elo_rating, users.competing FROM users WHERE id=? AND competing=true UNION ALL (SELECT users.id, users.discord_id, users.elo_rating, users.competing FROM users INNER JOIN users s ON users.elo_rating = s.elo_rating WHERE s.id = ? && users.id != ? && users.competing=true ORDER BY users.elo_rating DESC LIMIT ?) UNION ALL (SELECT users.id, users.discord_id, users.elo_rating, users.competing FROM users INNER JOIN users s ON users.elo_rating < s.elo_rating WHERE s.id = ? && users.competing=true ORDER BY users.elo_rating DESC LIMIT ?) UNION ALL (SELECT users.id, users.discord_id, users.elo_rating, users.competing FROM users INNER JOIN users s ON users.elo_rating > s.elo_rating WHERE s.id = ? && users.competing=true ORDER BY users.elo_rating LIMIT ?);', [user_id, user_id, user_id, amount * 2, user_id, amount, user_id, amount]);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description save weekly matchups in the database
 */
exports.saveWeeklyMatchups = async (matchups) => {
	var query = await exports.sql('SELECT id FROM matchups WHERE id=1;');
	var res;
	if (query.length > 0)
		res = await exports.sql('UPDATE matchups SET matchups=? WHERE id=1;', JSON.stringify(matchups));
	else
		res = await exports.sql('INSERT INTO matchups (matchups) VALUES (?);', JSON.stringify(matchups));
	return res.length > 0;
}

/**
 * @description save weekly matchups in the database
 */
exports.getWeeklyMatchups = async () => {
	var res = await exports.sql('SELECT matchups FROM matchups WHERE id=1;');
	if (res.length > 0) {
		var arr = JSON.parse(res[0].matchups);
		return arr;
	}
	return false;
}

exports.createChannel = async (id, type) => {
	var res = await exports.sql('INSERT INTO channels (channel_id, type) VALUES (?,?);', [id, type]);
	return res.length > 0;
}

exports.removeChannel = async (id) => {
	var res = await exports.sql('DELETE FROM channels WHERE channel_id=?', id)
	return res.length > 0;
}

exports.getChannels = async () => {
	var res = await exports.sql('SELECT * FROM channels;');
	if (res.length > 0)
		return res;
	return false;
}

exports.getChannel = async (id) => {
	var res = await exports.sql('SELECT * FROM channels WHERE channel_id=?;', id);
	if (res.length > 0)
		return res;
	return false;
}

exports.createTeamTable = async (type) => {
	let defaultElo = 1500;
	if (config.default_starting_elo)
		defaultElo = config.default_starting_elo;
	var res = await exports.sql(`CREATE TABLE IF NOT EXISTS ?? (id bigint primary key not null auto_increment, name varchar(255) not null, members varchar(255), elo_rating int default ? not null, competing boolean not null default false);`, ['teams_' + type, defaultElo]);
	return res.warningCount === 0;
}

exports.createTeam = async (type, teamName) => {
	var res = await exports.sql(`INSERT INTO ?? (name) VALUES (?);`, ['teams_' + type, teamName]);
	return res.warningCount === 0;
}

exports.getTeam = async (type, teamName) => {
	var res = await exports.sql(`SELECT * FROM ?? WHERE name=?;`, ['teams_' + type, teamName]);
	if (res.length > 0)
		return res;
	return false;
}

exports.modifyTeam = async (type, teamName, key, value) => {
	var res = await exports.sql(`UPDATE ?? SET ??=? WHERE name=?;`, ['teams_' + type, key, value, teamName]);
	return res.warningCount === 0;
}

exports.getPlayerTeam = async (type, playerId) => {
	var res = await exports.sql(`SELECT * FROM ?? WHERE player_id=?`, ['team_membership_' + type, playerId]);
	if (res && res.length > 0) {
		var ret = await exports.sql(`SELECT * FROM ?? WHERE id=?;`, ['teams_' + type, res[0].team_id]);
		if (ret)
			return ret;
	}
	return false;
}

exports.addPlayerToTeam = async (type, playerId, teamId) => {
	// TODO: address if a player has left a team and is joining another
	var res = await exports.sql(`INSERT INTO ?? (player_id, team_id) VALUES (?,?);`, ['team_membership_' + type, playerId, teamId]);
	if (res.warningCount === 0) {
		var res = await exports.sql(`SELECT members FROM ?? WHERE id=?;`, ['teams_' + type, teamId]);
		var newMembers = [];
		if (res) {
			if (res[0].members) {
				members = JSON.parse(res[0].members);
				for (var m in members) {
					newMembers.push(members[m]);
				}
			}
			newMembers.push(playerId);
			var res = await exports.sql(`UPDATE ?? SET members=? WHERE id=?;`, ['teams_' + type, JSON.stringify(newMembers), teamId]);
			return res.warningCount === 0;
		}
	}

	return false;
}

exports.removePlayerFromTeam = async (type, playerId) => {
	var team = await exports.getPlayerTeam(type, playerId);
	if (team) {
		var currentMembers = JSON.parse(team[0].members);
		var newMembers = [];
		for (m in currentMembers)
			if (currentMembers[m] !== playerId)
				newMembers.push(currentMembers[m]);
		var membersUpdate = await exports.sql(`UPDATE ?? SET members=? WHERE id=?;`, ['teams_' + type, JSON.stringify(newMembers), team[0].id]);
		if (membersUpdate.warningCount === 0) {
			var membershipUpdate = await exports.sql(`DELETE FROM ?? WHERE player_id=?`, ['team_membership_' + type, playerId]);
			if (membershipUpdate.warningCount === 0)
				return newMembers;
		}
	}
	return false;
}

exports.disbandTeam = async (type, teamName) => {
	var team = await exports.getTeam(type, teamName);
	if (team) {
		await exports.sql(`DELETE FROM ?? WHERE id=?`, ['teams_' + type, team[0].id]);
		await exports.sql(`DELETE FROM ?? WHERE team_id=?`, ['team_membership_' + type, team[0].id]);
		return true;
	}
	return false;
}

exports.createMatchesTable = async (type) => {
	var res = await exports.sql(`CREATE TABLE IF NOT EXISTS ?? (id bigint primary key not null auto_increment, team1 varchar(255) not null, team2 varchar(255) not null, result boolean not null default false, confirmed boolean not null default false, team1_net_elo int, team2_net_elo int, timestamp timestamp not null default current_timestamp);`, 'matches_' + type);
	return res.warningCount === 0;
}

exports.createInvite = async (type, teamName, discordIdFrom, discordIdTo) => {
	var res = await exports.sql(`INSERT INTO ?? (name, from, to) VALUES (?,?,?);`, ['invites_' + type, teamName, discordIdFrom, discordIdTo]);
	return res.length > 0;
}

exports.getInvite = async (type, sender, discordId) => {
	var from = 'to';
	if (sender)
		from = 'from';
	var res = await exports.sql(`SELECT * FROM ?? WHERE ?=?`, ['invites_' + type, from, discordId]);
	if (res.length > 0)
		return res;
	return false;
}
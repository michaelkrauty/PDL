const log = require('winston');
const config = require('./config.js').config;
const config_db = require('./config_db.js').db;

/**
 * @description connects to SQL database and creates necessary tables
 */
module.exports.connect = function () {
	return new Promise(async (resolve, reject) => {
		let mysql = await require('mysql');
		// connect to MySQL DB
		log.info(`Connecting to MySQL DB: ${config_db.user}@${config_db.host}...`);
		let con = await mysql.createConnection({
			host: config_db.host,
			user: config_db.user,
			password: config_db.password
		});
		await con.connect(function (err) {
			if (err) throw err;
			log.info('Connected to MySQL DB!');
		});
		// create DB if it doesn't already exist
		await con.query(`CREATE DATABASE IF NOT EXISTS ${config_db.database};`, function (err) {
			if (err) throw err;
		});
		// select DB
		await con.query(`USE ${config_db.database};`, function (err) {
			if (err) throw err;
		});
		// create DB tables if they don't already exist
		await con.query('CREATE TABLE IF NOT EXISTS users (id bigint primary key auto_increment, discord_id varchar(255), glicko2_rating int not null default 1500, glicko2_deviation int not null default 350, glicko2_volatility float not null default 0.06, elo_rating int not null default 1500, competing boolean not null default false);', function (err, res) {
			if (err) throw err;
			if (res['warningCount'] == 0)
				log.info('Created MySQL table `users`');
		});
		await con.query('CREATE TABLE IF NOT EXISTS matches (id bigint primary key auto_increment, player_id bigint not null, opponent_id bigint not null, result boolean not null default false, confirmed boolean not null default false, player_start_elo int, player_end_elo int, opponent_start_elo int, opponent_end_elo int, timestamp timestamp not null default current_timestamp);', function (err, res) {
			if (err) throw err;
			if (res['warningCount'] == 0)
				log.info('Created MySQL table `matches`');
		});
		// end connection to database
		await con.end();
		// create mysql connection pool
		pool = await mysql.createPool({
			host: config_db.host,
			database: config_db.database,
			user: config_db.user,
			password: config_db.password
		});
		resolve();
	});
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
	return exists;
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
		'INSERT INTO users (discord_id, elo_rating) VALUES (?,?);', [discord_id, Math.round(average_elo)]);
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
		return res[0].elo_rating;
	return false;
}

/**
 * @description get user's ELO rating
 * @param {bigint} id the user's id
 * @returns {success: boolean, elo_rating: int}
 */
exports.getAverageCompetingElo = async () => {
	var res = await exports.sql('SELECT AVG(elo_rating) AS avg FROM users WHERE competing=true;');
	if (res.length > 0)
		return res[0].avg;
	return config.default_starting_elo;
}

/**
 * @description get players who have not played a match this week
 * @returns {[users]}
 */
exports.getUsersToDecayElo = async () => {
	var res = await exports.sql('SELECT id, discord_id, elo_rating FROM users WHERE elo_rating > 0;');
	var users = [];
	for (var r in res) {
		var matches = await exports.getUserLatestMatchesOfPreviousWeek(res[r].id);
		if (!matches)
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
 * @description get user's glicko2 rating
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, glicko2_rating: int}
 */
exports.getUserGlicko2Rating = async (user_id) => {
	var res = await exports.sql('SELECT glicko2_rating FROM users WHERE id=?;', user_id);
	if (res.length > 0)
		return res[0].glicko2_rating;
	return false;
}

/**
 * @description get user's glicko2 deviation
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, glicko2_deviation: int}
 */
exports.getUserGlicko2Deviation = async (user_id) => {
	var res = await exports.sql('SELECT glicko2_deviation FROM users WHERE id=?;', user_id);
	if (res.length > 0)
		return res[0].glicko2_deviation;
	return false;
}

/**
 * @description get user's glicko2 volatility
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, glicko2_volatility: int}
 */
exports.getUserGlicko2Volatility = async (user_id) => {
	var res = await exports.sql('SELECT glicko2_volatility FROM users WHERE id=?;', user_id);
	if (res.length > 0)
		return res[0].glicko2_volatility;
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
 * @description get user's latest matches of this week
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserLatestMatchesOfWeek = async (user_id) => {
	var res = await exports.sql('SELECT * FROM matches WHERE (player_id=? OR opponent_id=?) AND (YEARWEEK(`timestamp`, 1) = YEARWEEK(CURDATE(), 1)) ORDER BY id ASC;', [user_id, user_id]);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserLatestMatchesOfPreviousWeek = async (user_id) => {
	var res = await exports.sql('SELECT * FROM matches WHERE (player_id=? OR opponent_id=?) AND (YEARWEEK(`timestamp`, 1) = (YEARWEEK(CURDATE(), 1)) - 1) ORDER BY id ASC;', [user_id, user_id]);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserNumConfirmedMatches = async (user_id) => {
	var res = await exports.sql('SELECT * FROM matches WHERE ((player_id=? OR opponent_id=?) AND confirmed=true) ORDER BY id ASC;', [user_id, user_id]);
	if (res.length > 0)
		return res;
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
 * @todo add rating method
 */
exports.getTopPlayers = async (amount, rating_method) => {
	var res = await exports.sql('SELECT * FROM users ORDER BY elo_rating DESC LIMIT ?;', amount);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description get the top x players on the leaderboard
 * @param {int} amount the amount of top players to retrieve
 * @returns {success: boolean, players: []}
 * @todo add rating method
 */
exports.getTopCompetingPlayers = async (amount, rating_method) => {
	var res = await exports.sql('SELECT * FROM users WHERE competing=true ORDER BY elo_rating DESC LIMIT ?;', amount);
	if (res.length > 0)
		return res;
	return false;
}

/**
 * @description get the top x players on the leaderboard
 * @param {int} amount the amount of top players to retrieve
 * @returns {success: boolean, players: []}
 * @todo add rating method
 */
exports.getNearbyPlayers = async (user_id, amount) => {
	var res = await exports.sql('SELECT users.id, users.discord_id, users.elo_rating, users.competing FROM users WHERE id=? AND competing=true UNION ALL (SELECT users.id, users.discord_id, users.elo_rating, users.competing FROM users INNER JOIN users s ON users.elo_rating = s.elo_rating WHERE s.id = ? && users.id != ? && users.competing=true ORDER BY users.elo_rating DESC LIMIT ?) UNION ALL (SELECT users.id, users.discord_id, users.elo_rating, users.competing FROM users INNER JOIN users s ON users.elo_rating < s.elo_rating WHERE s.id = ? && users.competing=true ORDER BY users.elo_rating DESC LIMIT ?) UNION ALL (SELECT users.id, users.discord_id, users.elo_rating, users.competing FROM users INNER JOIN users s ON users.elo_rating > s.elo_rating WHERE s.id = ? && users.competing=true ORDER BY users.elo_rating LIMIT ?);', [user_id, user_id, user_id, amount * 2, user_id, amount, user_id, amount]);
	if (res.length > 0)
		return res;
	return false;
}
const config = require('./config_db.js');
const mysql = require('mysql');
const log = require('winston');
var con;

/**
 * @description connects to SQL database and creates necessary tables
 */
exports.connect = function () {
	// connect to MySQL DB
	log.info('Connecting to MySQL DB: ' + config['db']['user'] + '@' + config['db']['host'] + '...');
	con = mysql.createConnection({
		host: config['db']['host'],
		user: config['db']['user'],
		password: config['db']['password'],
	});
	con.connect(function (err) {
		if (err) throw err;
		log.info('Connected to MySQL DB!');
	});
	// create DB if it doesn't already exist
	con.query('CREATE DATABASE IF NOT EXISTS `' + config['db']['database'] + '`', function (err) {
		if (err) throw err;
	});
	// select DB
	con.query('USE `' + config['db']['database'] + '`', function (err) {
		if (err) throw err;
	});
	// create DB tables if they don't already exist
	con.query('CREATE TABLE IF NOT EXISTS users (id bigint primary key auto_increment, discord_username varchar(255), discord_id varchar(255), glicko2_rating int not null default 1500, glicko2_deviation int not null default 350, glicko2_volatility float not null default 0.06, elo_rating int not null default 1500, competing boolean not null default false)', function (err, res) {
		if (err) throw err;
		if (res['warningCount'] == 0)
			log.info('Created MySQL table `users`');
	});
	con.query('CREATE TABLE IF NOT EXISTS matches (id bigint primary key auto_increment, player_id bigint not null, opponent_id bigint not null, result boolean not null default false, confirmed boolean not null default false, timestamp timestamp not null default current_timestamp)', function (err, res) {
		if (err) throw err;
		if (res['warningCount'] == 0)
			log.info('Created MySQL table `matches`');
	});
	// con.query('CREATE TABLE IF NOT EXISTS quests (id bigint primary key auto_increment, player_id bigint, quest varchar(255), amount int)', function (err, res) {
	// 	if (err) throw err;
	// 	if (res['warningCount'] == 0)
	// 		log.info('Created MySQL table `quests`');
	// });
}

/**
 * @description check if user exists in DB
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, exists: boolean}
 */
exports.checkUserExists = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT id FROM users WHERE discord_id=?;';
		await con.query(sql, discord_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, exists: true });
			} else {
				resolve({ success: true, exists: false });
			}
		});
	});
}

/**
 * @description register new user
 * @param {bigint} discord_id the user's discord id
 * @param {string} discord_username the user's discord username
 * @returns {success: boolean}
 */
exports.registerUser = function (discord_id, discord_username) {
	return new Promise(async function (resolve, reject) {
		exports.checkUserExists(discord_id).then(function (value) {
			if (value['success']) {
				if (value['exists']) {
					resolve({ success: false });
				} else {
					exports.createUserInDB(discord_id, discord_username).then(function (value) {
						resolve({ success: value['success'] });
					});
				}
			}
		});
	});
}

/**
 * @description create new user in DB
 * @param {bigint} discord_id the user's discord id
 * @param {string} discord_username the user's discord username
 * @returns {success: boolean}
 */
exports.createUserInDB = function (discord_id, discord_username) {
	return new Promise(async function (resolve, reject) {
		var sql = 'INSERT INTO users (discord_id, discord_username) VALUES (?,?);';
		await con.query(sql, [discord_id, discord_username], function (err) {
			if (err) throw err;
			resolve({ success: true });
		});
	});
}

/**
 * @description check if the user is competing
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, competing: boolean}
 */
exports.isUserCompeting = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT competing FROM users WHERE discord_id=?;';
		await con.query(sql, discord_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, competing: res[0]['competing'] });
			}
		});
	});
}

/**
 * @description set user's competing boolean
 * @param {bigint} discord_id the user's discord id
 * @param {boolean} competing is the user competing?
 * @returns {success: boolean}
 */
exports.setUserCompeting = function (discord_id, competing) {
	return new Promise(async function (resolve, reject) {
		var sql = 'UPDATE users SET competing=? WHERE discord_id=?;';
		await con.query(sql, [competing, discord_id], function (err) {
			if (err) throw err;
			resolve({ success: true });
		});
	});
}


/**
 * @todo
 * @description get all of a user's data
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, userdata[]}
 */
exports.getUserData = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT * FROM users WHERE discord_id=?;';
		await con.query(sql, discord_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, data: res[0] });
			}
		});
	});
}

/**
 * @description get user's ELO rating
 * @param {bigint} id the user's id
 * @returns {success: boolean, elo_rating: int}
 */
exports.getUserEloRating = function (user_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT elo_rating FROM users WHERE id=?;';
		await con.query(sql, user_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, elo_rating: res[0]['elo_rating'] });
			}
		});
	});
}

/**
 * @description get user's glicko2 rating
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, glicko2_rating: int}
 */
exports.getUserGlicko2Rating = function (user_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT glicko2_rating FROM users WHERE id=?;';
		await con.query(sql, user_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, glicko2_rating: res[0]['glicko2_rating'] });
			}
		});
	});
}

/**
 * @description get user's glicko2 deviation
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, glicko2_deviation: int}
 */
exports.getUserGlicko2Deviation = function (user_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT glicko2_deviation FROM users WHERE id=?;';
		await con.query(sql, user_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, glicko2_deviation: res[0]['glicko2_deviation'] });
			}
		});
	});
}

/**
 * @description get user's glicko2 volatility
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, glicko2_volatility: int}
 */
exports.getUserGlicko2Volatility = function (user_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT glicko2_volatility FROM users WHERE id=?;';
		await con.query(sql, user_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, glicko2_volatility: res[0]['glicko2_volatility'] });
			}
		});
	});
}

/**
 * @description set user's ELO ranking
 * @param {int} user_id the user's id
 * @param {int} elo the user's new ELO ranking
 * @returns {success: boolean}
 */
exports.setUserEloRating = function (user_id, elo) {
	return new Promise(async function (resolve, reject) {
		var sql = 'UPDATE users SET elo_rating=? WHERE id=?;';
		await con.query(sql, [elo, user_id], function (err) {
			if (err) throw err;
			resolve({ success: true });
		});
	});
}

/**
 * @description submit a match result
 * @param {int} discord_id the user's discord id
 * @param {int} opponent_discord_id the opponent's discord id
 * @param {int} result the result of the match
 * @returns {success: boolean}
 */
exports.submitMatchResult = function (discord_id, opponent_discord_id, result) {
	return new Promise(async function (resolve, reject) {
		var sql = 'INSERT INTO matches (player_id, opponent_id, result) VALUES (?, ?, ?);';
		await con.query(sql, [discord_id, opponent_discord_id, result], function (err) {
			if (err) throw err;
			resolve({ success: true });
		});
	});
}

/**
 * @description confirm a match result
 * @param {int} match_id the match to confirm
 * @param {boolean} confirmed is the match confirmed?
 * @returns {success: boolean}
 */
exports.setMatchResultConfirmed = function (match_id, confirmed) {
	return new Promise(async function (resolve, reject) {
		var sql = 'UPDATE matches SET confirmed=? WHERE id=?;';
		await con.query(sql, [confirmed, match_id], function (err) {
			if (err) throw err;
			resolve({ success: true });
		});
	});
}

/**
 * @description get Discord id from user id
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, discord_id: bigint}
 */
exports.getDiscordIdFromUserId = function (user_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT discord_id FROM users WHERE id=?;';
		await con.query(sql, user_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, discord_id: parseInt(res[0]['discord_id']) });
			}
		});
	});
}

/**
 * @description get user id from Discord id
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, id: bigint}
 */
exports.getUserIdFromDiscordId = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT id FROM users WHERE discord_id=?;';
		await con.query(sql, discord_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, id: parseInt(res[0]['id']) });
			}
		});
	});
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserLatestMatch = function (user_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT * FROM matches WHERE player_id=? ORDER BY id DESC LIMIT 1;';
		await con.query(sql, user_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, match: res[0] });
			} else {
				resolve({ success: true, match: null });
			}
		});
	});
}

/**
 * @description get an opponent's latest match
 * @param {bigint} opponent_id the opponent's id
 * @returns {success: boolean, match: []}
 */
exports.getOpponentLatestMatch = function (opponent_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT * FROM matches WHERE opponent_id=? ORDER BY id DESC LIMIT 1;';
		await con.query(sql, opponent_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, match: res[0] });
			}
		});
	});
}
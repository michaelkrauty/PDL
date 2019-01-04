const config = require('./config_db.js');
const mysql = require('mysql');
const log = require('winston');
var pool;

/**
 * @description connects to SQL database and creates necessary tables
 */
exports.connect = function () {
	new Promise(async function () {

		// connect to MySQL DB
		log.info('Connecting to MySQL DB: ' + config['db']['user'] + '@' + config['db']['host'] + '...');
		var con = await mysql.createConnection({
			host: config.db.host,
			user: config.db.user,
			password: config.db.password
		});
		await con.connect(function (err) {
			if (err) throw err;
			log.info('Connected to MySQL DB!');
		});
		// create DB if it doesn't already exist
		await con.query('CREATE DATABASE IF NOT EXISTS `' + config['db']['database'] + '`', function (err) {
			if (err) throw err;
		});
		// select DB
		await con.query('USE `' + config['db']['database'] + '`', function (err) {
			if (err) throw err;
		});
		// create DB tables if they don't already exist
		await con.query('CREATE TABLE IF NOT EXISTS users (id bigint primary key auto_increment, discord_username varchar(255), discord_id varchar(255), glicko2_rating int not null default 1500, glicko2_deviation int not null default 350, glicko2_volatility float not null default 0.06, elo_rating int not null default 1500, competing boolean not null default false)', function (err, res) {
			if (err) throw err;
			if (res['warningCount'] == 0)
				log.info('Created MySQL table `users`');
		});
		await con.query('CREATE TABLE IF NOT EXISTS matches (id bigint primary key auto_increment, player_id bigint not null, opponent_id bigint not null, result boolean not null default false, confirmed boolean not null default false, player_start_elo int, player_end_elo int, opponent_start_elo int, opponent_end_elo int, timestamp timestamp not null default current_timestamp)', function (err, res) {
			if (err) throw err;
			if (res['warningCount'] == 0)
				log.info('Created MySQL table `matches`');
		});
		await con.query('CREATE TABLE IF NOT EXISTS pending_matches (message_id varchar(255) primary key not null, match_id bigint not null, user_id bigint not null)', function (err, res) {
			if (err) throw err;
			if (res['warningCount'] == 0)
				log.info('Created MySQL table `pending_matches`');
		});
		await con.end();
		// con.query('CREATE TABLE IF NOT EXISTS quests (id bigint primary key auto_increment, player_id bigint, quest varchar(255), amount int)', function (err, res) {
		// 	if (err) throw err;
		// 	if (res['warningCount'] == 0)
		// 		log.info('Created MySQL table `quests`');
		// });
		pool = await mysql.createPool({
			host: config.db.host,
			database: config.db.database,
			user: config.db.user,
			password: config.db.password
		});
	});
}

/**
 * @description check if user exists in DB
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, exists: boolean}
 */
exports.checkUserExists = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT id FROM users WHERE discord_id=?;';
			con.query(sql, discord_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, exists: true });
				} else {
					resolve({ success: true, exists: false });
				}
				resolve({ success: false });
			});
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
				if (!value['exists']) {
					exports.createUserInDB(discord_id, discord_username).then(function (value) {
						resolve({ success: true, registered: value['success'] });
					});
				}
				resolve({ success: true });
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'INSERT INTO users (discord_id, discord_username) VALUES (?,?);';
			con.query(sql, [discord_id, discord_username], function (err) {
				con.release();
				if (err) throw err;
				resolve({ success: true });
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT competing FROM users WHERE discord_id=?;';
			con.query(sql, discord_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, competing: res[0]['competing'] });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'UPDATE users SET competing=? WHERE discord_id=?;';
			con.query(sql, [competing, discord_id], function (err) {
				con.release();
				if (err) throw err;
				resolve({ success: true });
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM users WHERE discord_id=?;';
			con.query(sql, discord_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, data: res[0] });
				} else {
					resolve({ success: false });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT elo_rating FROM users WHERE id=?;';
			con.query(sql, user_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, elo_rating: res[0]['elo_rating'] });
				}
			});
		});
	});
}

/**
 * @description get user's ELO rating
 * @param {bigint} id the user's id
 * @returns {success: boolean, rank: int}
 */
exports.getUserEloRanking = function (user_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT id, elo_rating, FIND_IN_SET( elo_rating, (SELECT GROUP_CONCAT( DISTINCT elo_rating ORDER BY elo_rating DESC ) FROM users)) AS rank FROM users WHERE id=?;';
			con.query(sql, user_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, rank: res[0]['rank'] });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT glicko2_rating FROM users WHERE id=?;';
			con.query(sql, user_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, glicko2_rating: res[0]['glicko2_rating'] });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT glicko2_deviation FROM users WHERE id=?;';
			con.query(sql, user_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, glicko2_deviation: res[0]['glicko2_deviation'] });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT glicko2_volatility FROM users WHERE id=?;';
			con.query(sql, user_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, glicko2_volatility: res[0]['glicko2_volatility'] });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'UPDATE users SET elo_rating=? WHERE id=?;';
			con.query(sql, [elo, user_id], function (err) {
				con.release();
				if (err) throw err;
				resolve({ success: true });
			});
		});
	});
}

/**
 * @description submit a match result
 * @param {int} user_id the user's discord id
 * @param {int} opponent_user_id the opponent's discord id
 * @param {int} result the result of the match (0 = loss, 1 = win)
 * @returns {success: boolean}
 */
exports.submitMatchResult = function (user_id, opponent_user_id, result) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'INSERT INTO matches (player_id, opponent_id, result) VALUES (?, ?, ?);';
			con.query(sql, [user_id, opponent_user_id, result], function (err) {
				con.release();
				if (err) throw err;
				resolve({ success: true });
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'UPDATE matches SET confirmed=? WHERE id=?;';
			con.query(sql, [confirmed, match_id], function (err) {
				con.release();
				if (err) throw err;
				resolve({ success: true });
			});
		});
	});
}

/**
 * @description confirm a match result
 * @param {int} match_id the match to confirm
 * @param {boolean} confirmed is the match confirmed?
 * @returns {success: boolean}
 */
exports.putPendingMatch = function (message_id, match_id, user_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'INSERT INTO pending_matches (message_id, match_id, user_id) VALUES (?,?,?);';
			con.query(sql, [message_id, match_id, user_id], function (err) {
				con.release();
				if (err) throw err;
				resolve({ success: true });
			});
		});
	});
}

/**
 * @description get user id from Discord id
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, id: bigint}
 */
exports.getPendingMatch = function (message_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT match_id FROM pending_matches WHERE message_id=?;';
			con.query(sql, message_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, match_id: parseInt(res[0]['match_id']) });
				} else {
					// TODO: id: null?
					resolve({ success: false });
				}
			});
		});
	});
}

/**
 * @description get user id from Discord id
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, id: bigint}
 */
exports.removePendingMatch = function (message_id, match_id, user_id) {
	match_id = match_id || 0;
	user_id = user_id || 0;
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'DELETE FROM pending_matches WHERE (message_id=? OR match_id=? OR user_id=?);';
			con.query(sql, [message_id, match_id, user_id], function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true });
				} else {
					// TODO: id: null?
					resolve({ success: false });
				}
			});
		});
	});
}

/**
 * @description get user id from Discord id
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, id: bigint}
 */
exports.getUserPendingMatches = function (user_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM pending_matches WHERE user_id=?;';
			con.query(sql, user_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, matches: res });
				} else {
					// TODO: id: null?
					resolve({ success: false });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT discord_id FROM users WHERE id=?;';
			con.query(sql, user_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, discord_id: BigInt(res[0]['discord_id']) });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT id FROM users WHERE discord_id=?;';
			con.query(sql, discord_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, id: parseInt(res[0]['id']) });
				} else {
					// TODO: id: null?
					resolve({ success: false });
				}
			});
		});
	});
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserLatestMatches = function (user_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM matches WHERE (player_id=? OR opponent_id=?) AND confirmed=false ORDER BY id ASC;';
			con.query(sql, [user_id, user_id], function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, matches: res });
				} else {
					resolve({ success: true });
				}
			});
		});
	});
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserLatestMatchVs = function (user_id, target_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM matches WHERE player_id=? AND opponent_id=? ORDER BY id DESC LIMIT 1;';
			con.query(sql, [user_id, target_id], function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, match: res[0] });
				} else {
					// TODO: id: null?
					resolve({ success: true });
				}
			});
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
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM matches WHERE opponent_id=? ORDER BY id DESC LIMIT 1;';
			con.query(sql, opponent_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, match: res[0] });
				} else {
					resolve({ success: false });
				}
			});
		});
	});
}

/**
 * @description get an opponent's latest match
 * @param {bigint} opponent_id the opponent's id
 * @returns {success: boolean, match: []}
 */
exports.getOpponentLatestMatchVs = function (opponent_id, player_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM matches WHERE opponent_id=? AND player_id=? ORDER BY id DESC LIMIT 1;';
			con.query(sql, [opponent_id, player_id], function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, match: res[0] });
				} else {
					resolve({ success: false });
				}
			});
		});
	});
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getUserLatestMatchesOfWeek = function (user_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM matches WHERE (player_id=? OR opponent_id=?) AND confirmed=false AND (WHERE  YEARWEEK(`date`, 1) = YEARWEEK(CURDATE(), 1)) ORDER BY id DESC;';
			con.query(sql, [user_id, user_id], function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, matches: res });
				} else {
					resolve({ success: true });
				}
			});
		});
	});
}

/**
 * @description get user's latest match
 * @param {bigint} user_id the user's id
 * @returns {success: boolean, match: []}
 */
exports.getMatch = function (match_id) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM matches WHERE id=?;';
			con.query(sql, match_id, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, match: res[0] });
				} else {
					// TODO: id: null?
					resolve({ success: true });
				}
			});
		});
	});
}

/**
 * @description get the top x players on the leaderboard
 * @param {int} amount the amount of top players to retrieve
 * @returns {success: boolean, players: []}
 * @todo add rating method
 */
exports.getTopPlayers = function (amount, rating_method) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM users ORDER BY elo_rating DESC LIMIT ?;';
			con.query(sql, amount, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, players: res });
				} else {
					resolve({ success: true });
				}
			});
		});
	});
}

/**
 * @description get the top x players on the leaderboard
 * @param {int} amount the amount of top players to retrieve
 * @returns {success: boolean, players: []}
 * @todo add rating method
 */
exports.getTopCompetingPlayers = function (amount, rating_method) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT * FROM users WHERE competing=true ORDER BY elo_rating DESC LIMIT ?;';
			con.query(sql, amount, function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, players: res });
				} else {
					resolve({ success: true });
				}
			});
		});
	});
}

/**
 * @description get the top x players on the leaderboard
 * @param {int} amount the amount of top players to retrieve
 * @returns {success: boolean, players: []}
 * @todo add rating method
 */
exports.getNearbyPlayers = function (user_id, amount) {
	return new Promise(async function (resolve, reject) {
		pool.getConnection(function (err, con) {
			if (err) throw err;
			var sql = 'SELECT users.id, users.discord_username, users.elo_rating FROM users WHERE ID=? UNION ALL(SELECT users.id, users.discord_username, users.elo_rating FROM users INNER JOIN users s ON users.elo_rating = s.elo_rating WHERE s.ID = ? && users.id != ? ORDER BY users.elo_rating DESC LIMIT ?) UNION ALL(SELECT users.id, users.discord_username, users.elo_rating FROM users INNER JOIN users s ON users.elo_rating < s.elo_rating WHERE s.ID = ? ORDER BY users.elo_rating DESC LIMIT ?) UNION ALL(SELECT users.id, users.discord_username, users.elo_rating FROM users INNER JOIN users s ON users.elo_rating > s.elo_rating WHERE s.ID = ? ORDER BY users.elo_rating LIMIT ?);';
			con.query(sql, [user_id, user_id, user_id, amount * 2, user_id, amount, user_id, amount], function (err, res) {
				con.release();
				if (err) throw err;
				if (res.length > 0) {
					resolve({ success: true, players: res });
				} else {
					resolve({ success: true });
				}
			});
		});
	});
}
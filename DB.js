const config = require('./config.js');
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
	con.query('CREATE TABLE IF NOT EXISTS users (id bigint primary key auto_increment, discord_username varchar(255), discord_id bigint, skill_rating int not null default 1500, rating_deviation int not null default 350, skill_volatility float not null default 0.06, competing boolean not null default false)', function (err, res) {
		if (err) throw err;
		if (res['warningCount'] == 0)
			log.info('Created MySQL table "users"');
	});
	con.query('CREATE TABLE IF NOT EXISTS matches (id bigint primary key auto_increment, player_id bigint, opponent bigint, result tinyint)', function (err, res) {
		if (err) throw err;
		if (res['warningCount'] == 0)
			log.info('Created MySQL table "matches"');
	});
	con.query('CREATE TABLE IF NOT EXISTS quests (id bigint primary key auto_increment, player_id bigint, quest varchar(255), amount int)', function (err, res) {
		if (err) throw err;
		if (res['warningCount'] == 0)
			log.info('Created MySQL table "quests"');
	});
}

/**
 * @description check if user exists in DB
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, exists: boolean}
 */
exports.checkUserExists = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT id FROM users WHERE discord_id=?';
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
		var sql = 'INSERT INTO users (discord_username, discord_id) VALUES (?,?)';
		await con.query(sql, [discord_username, discord_id], function (err) {
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
		var sql = 'SELECT competing FROM users WHERE discord_id=?';
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
		var sql = 'UPDATE users SET competing=? WHERE discord_id=?';
		await con.query(sql, [competing, discord_id], function (err) {
			if (err) throw err;
			resolve({ success: true });
		});
	});
}

/**
 * @description get user's skill rating
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, skill_rating: int}
 */
exports.getRating = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT skill_rating FROM users WHERE discord_id=?';
		await con.query(sql, discord_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, skill_rating: res[0]['skill_rating'] });
			}
		});
	});
}

/**
 * @description get user's rating deviation
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, rating_deviation: int}
 */
exports.getRatingDeviation = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT rating_deviation FROM users WHERE discord_id=?';
		await con.query(sql, discord_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, rating_deviation: res[0]['rating_deviation'] });
			}
		});
	});
}

/**
 * @description get user's skill volatility
 * @param {bigint} discord_id the user's discord id
 * @returns {success: boolean, skill_volatility: int}
 */
exports.getSkillVolatility = function (discord_id) {
	return new Promise(async function (resolve, reject) {
		var sql = 'SELECT skill_volatility FROM users WHERE discord_id=?';
		await con.query(sql, discord_id, function (err, res) {
			if (err) throw err;
			if (res.length > 0) {
				resolve({ success: true, skill_volatility: res[0]['skill_volatility'] });
			}
		});
	});
}
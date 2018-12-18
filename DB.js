const config = require('./config.js');
const mysql = require('mysql');
const log = require('winston');
var con;

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
	con.query('CREATE TABLE IF NOT EXISTS users (id bigint primary key auto_increment, discord_username varchar(255), discord_id bigint, skill_rating int not null default 1500, rating_deviation int, skill_volatility competing boolean not null default 0)', function (err, res) {
		if (err) throw err;
		if (res['warningCount'] == 0)
			log.info('Created MySQL table "users"');
	});
	con.query('CREATE TABLE IF NOT EXISTS quests (id bigint primary key auto_increment, player_id bigint, quest varchar(255), amount int)', function (err, res) {
		if (err) throw err;
		if (res['warningCount'] == 0)
			log.info('Created MySQL table "quests"');
	});
}

// check if user exists in DB
// returns {success: boolean, exists: boolean}
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

// register new user
// returns {success: boolean}
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

// create new user in DB
// returns {success: boolean}
exports.createUserInDB = function (discord_id, discord_username) {
	return new Promise(async function (resolve, reject) {
		var sql = 'INSERT INTO users (discord_username, discord_id) VALUES (?,?)';
		await con.query(sql, [discord_username, discord_id], function (err) {
			if (err) throw err;
			resolve({ success: true });
		});
	});
}

// check if user is competing
// returns {success: boolean, competing: boolean}
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

// set user's competing boolean
// returns {success: boolean}
exports.setUserCompeting = function (discord_id, competing) {
	return new Promise(async function (resolve, reject) {
		var sql = 'UPDATE users SET competing=? WHERE discord_id=?';
		await con.query(sql, [competing, discord_id], function (err) {
			if (err) throw err;
			resolve({ success: true });
		});
	});
}

// get user's skill rating
// returns {success: boolean, skill_rating: int}
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
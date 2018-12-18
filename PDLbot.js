var discord = require('discord.io');
var log = require('winston');
var mysql = require('mysql');
var auth = require('./auth.json');
var config = require('./config.js');
var con;
// Configure logger settings
log.remove(log.transports.Console);
log.add(new log.transports.Console, {
    colorize: true
});
log.level = 'debug';
// Initialize Discord bot
var bot = new discord.Client({
    token: auth.token,
    autorun: true
});
// Bot startup
bot.on('ready', function (evt) {
    log.info('Logged in as: ' + bot.username + ' - (' + bot.id + ')');
    log.info('Connecting to MySQL DB: ' + config['db']['user'] + '@' + config['db']['host'] + '...');
    // Connect to MySQL DB
    con = mysql.createConnection({
        host: config['db']['host'],
        user: config['db']['user'],
        password: config['db']['password'],
    });
    con.connect(function (err) {
        if (err) throw err;
        log.info('Connected to MySQL DB!');
    });
    // Create Database if it doesn't already exist
    con.query('CREATE DATABASE IF NOT EXISTS `' + config['db']['database'] + '`', function (err) {
        if (err) throw err;
    });
    // Select Database
    con.query('USE `' + config['db']['database'] + '`', function (err) {
        if (err) throw err;
    });
    // Create DB tables if they don't already exist
    con.query('CREATE TABLE IF NOT EXISTS users (id bigint primary key auto_increment, discord_username varchar(255), discord_id bigint, 1v1_elo int not null default 1500, competing boolean not null default 0)', function (err, res) {
        if (err) throw err;
        if (res['warningCount'] == 0)
            log.info('Created MySQL table "users"');
    });
    con.query('CREATE TABLE IF NOT EXISTS quests (id bigint primary key auto_increment, player_id bigint, quest varchar(255), amount int)', function (err, res) {
        if (err) throw err;
        if (res['warningCount'] == 0)
            log.info('Created MySQL table "quests"');
    });
});

// Called when a message is sent
bot.on('message', function (user, userID, channelID, message, evt) {
    // Commands start with !
    if (message.substring(0, 1) == '!') {
        var args = message.substring(1).split(' ');
        var cmd = args[0];

        args = args.splice(1);
        switch (cmd) {
            // !help
            case 'help':
                botMessage(channelID, '');
                break;
            case 'check':
                break;
            // !register
            case 'register':
                // check if user already exists
                var sql = 'SELECT id FROM users WHERE discord_id=?';
                con.query(sql, userID, function (err, res) {
                    if (err) throw err;
                    if (res.length > 0) {
                        botMessage(channelID, tag(userID) + ', you are already registered in the Pavlov Duel League!');
                    } else {
                        // create user
                        var sql = 'INSERT INTO users (discord_username, discord_id) VALUES ?';
                        var values = [
                            [user, userID]
                        ];
                        con.query(sql, [values], function (err) {
                            if (err) throw err;
                            botMessage(channelID, tag(userID) + ' is now registered in the Pavlov Duel League!');
                        });
                    }
                });
                break;
            case 'compete':
                var sql = 'UPDATE users SET competing = 1 WHERE discord_id=?';
                con.query(sql, userID, function (err) {
                    if (err) throw err;
                    botMessage(channelID, tag(userID) + ' is now competing in PDL!');
                });
                break;
            case 'retire':
                var sql = 'UPDATE users SET competing = 0 WHERE discord_id=?';
                con.query(sql, userID, function (err) {
                    if (err) throw err;
                    botMessage(channelID, tag(userID) + ' is no longer competing in PDL!');
                });
                break;
            case 'elo':
                let eloTest = async function () {
                    getELO(userID()).then(function (value) {
                        botMessage(channelID, tag(userID) + ' your ELO is ' + value['elo'] + '.');
                    })
                }

                var eloResult = getELO(userID);
                if (eloResult['success']) {
                    botMessage(channelID, tag(userID) + ' your ELO is ' + getELO['elo'] + '.')
                }
                break;
        }
    }
});

function registerUser(discord_id, discord_username) {
    // check if user already exists
    var sql = 'SELECT id FROM users WHERE discord_id=?';
    con.query(sql, discord_id, function (err, res) {
        if (err) throw err;
        if (res.length > 0) {
            return 1;
        } else {
            // create user
            var sql = 'INSERT INTO users (discord_username, discord_id) VALUES ?';
            var values = [
                [discord_username, discord_id]
            ];
            con.query(sql, [values], function (err) {
                if (err) throw err;
                return 0;
            });
        }
    });
}

async function getELO(discord_id) {
    var sql = 'SELECT 1v1_elo FROM users WHERE discord_id=?';
    con.query(sql, discord_id, function (err, res) {
        if (err) throw err;
        if (res.length > 0) {
            return { success: false };
        }
        return { success: true, elo: res }
    });
}

function botMessage(channelID, message) {
    bot.sendMessage({
        to: channelID,
        message: message
    });
}

function tag(userID) {
    return '<@' + userID + '>';
}
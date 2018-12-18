var discord = require('discord.io');
var log = require('winston');
var mysql = require('mysql');
var auth = require('./auth.json');
var config = require('./config.js');
var con;
// configure logger settings
log.remove(log.transports.Console);
log.add(new log.transports.Console, {
    colorize: true
});
log.level = 'debug';
// initialize Discord bot
var bot = new discord.Client({
    token: auth.token,
    autorun: true
});
// bot startup
bot.on('ready', function (evt) {
    log.info('Logged in as: ' + bot.username + ' - (' + bot.id + ')');
    log.info('Connecting to MySQL DB: ' + config['db']['user'] + '@' + config['db']['host'] + '...');
    // connect to MySQL DB
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

// called when the bot sees a message
bot.on('message', function (user, userID, channelID, message, evt) {
    // commands start with !
    if (message.substring(0, 1) == '!') {
        var args = message.substring(1).split(' ');
        var cmd = args[0];

        args = args.splice(1);
        switch (cmd) {
            case 'help':
                // help dialogue
                botMessage(channelID, '```PDL-bot commands:\n!register: Register in PDL\n!compete: Compete in PDL\n!retire: Stop competing in PDL\n!competing: Check whether you are currently competing\n!check: Check if you are registered in PDL\n!elo: Get your current ELO```');
                break;
            case 'register':
                // register new user
                registerUser(userID, user).then(function (value) {
                    if (value['success']) {
                        botMessage(channelID, tag(userID) + ' is now registered in the Pavlov Duel League!');
                    } else {
                        botMessage(channelID, tag(userID) + ', you are already registered in the Pavlov Duel League!');
                    }
                });
                break;
            case 'compete':
                // register user if they're not already in the DB
                registerUser(userID, user).then(function () {
                    setUserCompeting(userID, true).then(function (value) {
                        if (value['success']) {
                            botMessage(channelID, tag(userID) + ' is now competing in PDL!');
                        }
                    });
                });
                break;
            case 'retire':
                // stop competing, but keep data in DB
                checkUserExists(userID).then(function (value) {
                    if (value['success'] && value['exists']) {
                        setUserCompeting(userID, false).then(function (value) {
                            if (value['success']) {
                                botMessage(channelID, tag(userID) + ' is no longer competing in PDL!');
                            }
                        });
                    } else {
                        botMessage(channelID, tag(userID) + ', you are not registered in PDL. Use !register to register!');
                    }
                });
                break;
            case 'competing':
                // check if user is currently competing
                checkUserExists(userID).then(function (value) {
                    if (value['success'] && value['exists']) {
                        isUserCompeting(userID).then(function (value) {
                            if (value['success'] && value['competing']) {
                                botMessage(channelID, tag(userID) + ' is competing.');
                            } else {
                                botMessage(channelID, tag(userID) + ' is not competing.');
                            }
                        });
                    } else {
                        botMessage(channelID, tag(userID) + ', you are not registered in PDL. Use !register to register!');
                    }
                });
                break;
            case 'check':
                // check if user exists in DB
                checkUserExists(userID).then(function (value) {
                    if (value['success'] && value['exists']) {
                        botMessage(channelID, tag(userID) + ' is registered in the Pavlov Duel League.');
                    } else {
                        botMessage(channelID, tag(userID) + ' is not registered in the Pavlov Duel League.');
                    }
                });
                break;
            case 'elo':
                // get user ELO
                checkUserExists(userID).then(function (value) {
                    if (value['success'] && value['exists']) {
                        getELO(userID).then(function (value) {
                            if (value['success']) {
                                botMessage(channelID, tag(userID) + ' your ELO is ' + value['elo'] + '.');
                            } else {
                                log.debug('fail');
                                botMessage(channelID, 'FAIL');
                            }
                        });
                    } else {
                        botMessage(channelID, tag(userID) + ', you are not registered in PDL. Use !register to register!');
                    }
                });
                break;
        }
    }
});

// check if user exists in DB
// returns {success: boolean, exists: boolean}
function checkUserExists(discord_id) {
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
function registerUser(discord_id, discord_username) {
    return new Promise(async function (resolve, reject) {
        checkUserExists(discord_id).then(function (value) {
            if (value['success']) {
                if (value['exists']) {
                    resolve({ success: false });
                } else {
                    createUserInDB(discord_id, discord_username).then(function (value) {
                        resolve({ success: value['success'] });
                    });
                }
            }
        });
    });
}

// create new user in DB
// returns {success: boolean}
function createUserInDB(discord_id, discord_username) {
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
function isUserCompeting(discord_id) {
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
function setUserCompeting(discord_id, competing) {
    return new Promise(async function (resolve, reject) {
        var sql = 'UPDATE users SET competing=? WHERE discord_id=?';
        await con.query(sql, [competing, discord_id], function (err) {
            if (err) throw err;
            resolve({ success: true });
        });
    });
}

// get user's ELO
// returns {success: boolean, elo: int}
function getELO(discord_id) {
    return new Promise(async function (resolve, reject) {
        var sql = 'SELECT 1v1_elo FROM users WHERE discord_id=?';
        await con.query(sql, discord_id, function (err, res) {
            if (err) throw err;
            if (res.length > 0) {
                resolve({ success: true, elo: res[0]['1v1_elo'] });
            }
        });
    });
}

// send a message from the bot
function botMessage(channelID, message) {
    bot.sendMessage({
        to: channelID,
        message: message
    });
}

// tag a user by userID
function tag(userID) {
    return '<@' + userID + '>';
}
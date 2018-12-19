const discord = require('discord.io');
const log = require('winston');
const schedule = require('node-schedule');
const auth = require('./auth.json');
const db = require('./DB.js');

const glicko2 = require('glicko2');
const glicko2_settings = {
	// tau : "Reasonable choices are between 0.3 and 1.2, though the system should
	//      be tested to decide which value results in greatest predictive accuracy."
	tau: 0.5,
	// rating : default rating
	rating: 1500,
	//rd : Default rating deviation 
	//     small number = good confidence on the rating accuracy
	rd: 350,
	//vol : Default volatility (expected fluctation on the player rating)
	vol: 0.06
};
var ranking = new glicko2.Glicko2(glicko2_settings);

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
	db.connect();
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
				if (args.length == 0) {
					// help dialogue
					botMessage(channelID, '```PDL-bot commands:\n!register: Register in PDL\n!compete: Compete in PDL\n!retire: Stop competing in PDL\n!competing: Check whether you are currently competing\n!check: Check if you are registered in PDL\n!elo: Get your current ELO```');
				}
				break;
			case 'register':
				// register new user
				db.registerUser(userID, user).then(function (value) {
					if (value['success']) {
						botMessage(channelID, tag(userID) + ' is now registered in the Pavlov Duel League!');
					} else {
						botMessage(channelID, tag(userID) + ', you are already registered in the Pavlov Duel League!');
					}
				});
				break;
			case 'compete':
				// register user if they're not already in the DB
				db.registerUser(userID, user).then(function () {
					db.setUserCompeting(userID, true).then(function (value) {
						if (value['success']) {
							botMessage(channelID, tag(userID) + ' is now competing in PDL!');
						}
					});
				});
				break;
			case 'retire':
				// stop competing, but keep data in DB
				db.checkUserExists(userID).then(function (value) {
					if (value['success'] && value['exists']) {
						db.setUserCompeting(userID, false).then(function (value) {
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
				db.checkUserExists(userID).then(function (value) {
					if (value['success'] && value['exists']) {
						db.isUserCompeting(userID).then(function (value) {
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
				db.checkUserExists(userID).then(function (value) {
					if (value['success'] && value['exists']) {
						botMessage(channelID, tag(userID) + ' is registered in the Pavlov Duel League.');
					} else {
						botMessage(channelID, tag(userID) + ' is not registered in the Pavlov Duel League.');
					}
				});
				break;
			case 'elo':
			case 'rating':
			case 'skill':
			case 'sr':
				// get user skill rating
				db.checkUserExists(userID).then(function (value) {
					if (value['success'] && value['exists']) {
						db.getRating(userID).then(function (value) {
							if (value['success']) {
								botMessage(channelID, tag(userID) + ' your SR is ' + value['elo'] + '.');
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
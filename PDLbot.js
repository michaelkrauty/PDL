const discord = require('discord.js');
const log = require('winston');
const schedule = require('node-schedule');
const auth = require('./auth.json');
const config = require('./config.js');
const db = require('./DB.js');

const glicko2lite = require('glicko2-lite');
const glicko2 = require('glicko2');

// configure logger settings
log.remove(log.transports.Console);
log.add(new log.transports.Console, {
	colorize: true
});
log.level = 'debug';

// initialize Discord bot
const client = new discord.Client();
client.login(config['bot_token']);
client.once('ready', () => {
	log.info('Logged in as: ' + client.username + ' - (' + client.id + ')');
	db.connect();
});

// called when the bot sees a message
client.on('message', message => {
	// commands start with !
	if (message.content.substring(0, 1) == '!') {
		var args = message.content.substring(1).split(' ');
		var cmd = args[0];

		args = args.splice(1);
		switch (cmd) {
			case 'debug':
				db.getUserData(message.author.id).then(function (value) {
					if (value['success']) {
						var msg = '';
						for (let elem in value['data']) {
							msg += elem + ': ' + value['data'][elem] + '\n'
							console.log(elem + ': ' + value['data'][elem]);
						}
						message.channel.send('```javascript\n' + msg + '```');
					}
				});
				break;
			case 'help':
				if (args.length == 0) {
					// help dialogue
					message.channel.send('```PDL-bot Commands:\nSyntax: <> = required paramater, [] = optional paramater\n!register: Register in PDL\n!compete: Compete in PDL\n!retire: Stop competing in PDL\n!competing [user]: Check whether you are currently competing\n!check [user]: Check registration in PDL\n!sr [user]: Get current SR\'s SR```');
				}
				break;
			case 'register':
				// register new user
				db.registerUser(message.author.id, message.author.username).then(function (value) {
					if (value['success']) {
						message.channel.send(tag(message.author.id) + ' is now registered in the Pavlov Duel League!');
					} else {
						message.channel.send(tag(message.author.id) + ', you are already registered in the Pavlov Duel League!');
					}
				});
				break;
			case 'compete':
				// register user if they're not already in the DB
				db.registerUser(message.author.id, message.author.username).then(function () {
					db.setUserCompeting(message.author.id, true).then(function (value) {
						if (value['success']) {
							message.channel.send(tag(message.author.id) + ' is now competing in PDL!');
						}
					});
				});
				break;
			case 'retire':
				// stop competing, but keep data in DB
				db.checkUserExists(message.author.id).then(function (value) {
					if (value['success'] && value['exists']) {
						db.setUserCompeting(message.author.id, false).then(function (value) {
							if (value['success']) {
								message.channel.send(tag(message.author.id) + ' is no longer competing in PDL!');
							}
						});
					} else {
						message.channel.send(tag(message.author.id) + ', you are not registered in PDL. Use !register to register!');
					}
				});
				break;
			case 'competing':
				// check if user is currently competing
				db.checkUserExists(message.author.id).then(function (value) {
					if (value['success'] && value['exists']) {
						db.isUserCompeting(message.author.id).then(function (value) {
							if (value['success'] && value['competing']) {
								message.channel.send(tag(message.author.id) + ' is competing.');
							} else {
								message.channel.send(tag(message.author.id) + ' is not competing.');
							}
						});
					} else {
						message.channel.send(tag(message.author.id) + ', you are not registered in PDL. Use !register to register!');
					}
				});
				break;
			case 'check':
				// check if user exists in DB
				if (args.length == 0) {
					db.checkUserExists(message.author.id).then(function (value) {
						if (value['success'] && value['exists']) {
							message.channel.send(tag(message.author.id) + ' is registered in the Pavlov Duel League.');
						} else {
							message.channel.send(tag(message.author.id) + ' is not registered in the Pavlov Duel League.');
						}
					});
				} else if (args.length == 1) {
					targetUser = message.mentions.users.values().next().value.username;
					targetID = message.mentions.users.values().next().value.id;
					db.checkUserExists(targetID).then(function (value) {
						if (value['success'] && value['exists']) {
							message.channel.send(tag(message.author.id) + ' ' + targetUser + ' is registered in the Pavlov Duel League.');
						} else {
							message.channel.send(tag(message.author.id) + ' ' + targetUser + ' is not registered in the Pavlov Duel League.');
						}
					})
				}
				break;
			case 'elo':
			case 'rating':
			case 'skill':
			case 'sr':
				// get user ELO rating
				db.checkUserExists(message.author.id).then(function (value) {
					if (value['success'] && value['exists']) {
						db.getUserEloRating(message.author.id).then(function (value) {
							if (value['success']) {
								message.channel.send(tag(message.author.id) + ' your SR is ' + value['elo_rating'] + '.');
							} else {
								log.error('fail');
								message.channel.send('FAIL');
							}
						});
					} else {
						message.channel.send(tag(message.author.id) + ', you are not registered in PDL. Use !register to register!');
					}
				});
				break;
			case 'submit':

				break;
		}
	}
});

// tag a user by userID
function tag(userID) {
	return '<@' + userID + '>';
}

function updateRatings() {
	var ranking = new glicko2.Glicko2();
	var scorched = ranking.makePlayer(1500, 350, 0.06);
	var maverick = ranking.makePlayer(1500, 350, 0.06);

	var matches = [];
	matches.push([scorched, maverick, 1]);
	matches.push([maverick, scorched, 1]);
	matches.push([scorched, maverick, 1]);
	ranking.updateRatings(matches);
	console.log("scorched rating: " + scorched.getRating());
	console.log("scorched deviation: " + scorched.getRd());
	console.log("scorched volatility: " + scorched.getVol());
}
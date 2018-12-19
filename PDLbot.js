const discord = require('discord.js');
const log = require('winston');
const schedule = require('node-schedule');
const auth = require('./auth.json');
const config = require('./config.js');
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

const client = new discord.Client();

client.once('ready', () => {
	log.info('Logged in as: ' + client.username + ' - (' + client.id + ')');
	db.connect();
});
client.login(config['bot_token']);


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
					message.channel.send('```PDL-bot commands:\n!register: Register in PDL\n!compete: Compete in PDL\n!retire: Stop competing in PDL\n!competing: Check whether you are currently competing\n!check: Check if you are registered in PDL\n!elo: Get your current ELO```');
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
				// get user skill rating
				db.checkUserExists(message.author.id).then(function (value) {
					if (value['success'] && value['exists']) {
						db.getRating(message.author.id).then(function (value) {
							if (value['success']) {
								message.channel.send(tag(message.author.id) + ' your SR is ' + value['skill_rating'] + '.');
							} else {
								log.debug('fail');
								message.channel.send('FAIL');
							}
						});
					} else {
						message.channel.send(tag(message.author.id) + ', you are not registered in PDL. Use !register to register!');
					}
				});
				break;
		}
	}
});

// tag a user by userID
function tag(userID) {
	return '<@' + userID + '>';
}
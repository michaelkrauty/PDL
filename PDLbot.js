const discord = require('discord.js');
const log = require('winston');
const schedule = require('node-schedule');
const auth = require('./auth.json');
const config = require('./config.js');
const db = require('./DB.js');
const strings = require('./strings.js');

const glicko2lite = require('glicko2-lite');
const glicko2 = require('glicko2');
const eloRating = require('elo-rating');

const MatchResult = { WIN: 1, LOSS: 0 }
const RatingMethod = { ELO: 0, GLICKO2_LIVE: 1, GLICKO2_SCHEDULE: 2 }
const ReactionEmoji = { WIN: '✅', LOSS: '❎', CONFIRMED: '👌' }
exports = MatchResult, RatingMethod;

// configure logger settings
log.remove(log.transports.Console);
log.add(new log.transports.Console, {
	colorize: true
});
log.level = 'debug';

// initialize Discord bot
const client = new discord.Client();
client.login(auth.token);
client.once('ready', () => {
	log.info('Logged in as: ' + client.username + ' - (' + client.id + ')');
	db.connect();
});


// called when the bot sees a message
client.on('message', message => {
	// commands start with !
	if (message.content.substring(0, 1) != '!')
		return;
	var args = message.content.substring(1).split(' ');
	const cmd = args[0];
	args = args.splice(1);
	// running the command must be async due to database interactions
	async function command() {
		switch (cmd) {
			case 'debug':
				// debug command for debugging purposes
				// get user data
				var user_data = await db.getUserData(message.author.id);
				if (!user_data['success']) {
					break;
				}
				// display user data
				var msg = '';
				for (var elem in user_data['data']) {
					msg += elem + ': ' + user_data['data'][elem] + '\n'
					console.log(elem + ': ' + user_data['data'][elem]);
				}
				message.channel.send('```javascript\n' + msg + '```');
				break;
			case 'say':
				// TODO: remove this command before release
				// make the bot say a message, for debug only
				var msg = '';
				for (i = 0; i < args.length; i++) {
					((i - 1 < args.length) ? msg += args[i] + ' ' : msg += args[i]);
				}
				message.channel.send(msg);
				break;
			case 'help':
				// shows help dialogue
				channel.send(strings['help']);
				break;
			case 'register':
				// registers user in database
				if (args.length == 0) {
					// register message.author
					var register_user = await db.registerUser(message.author.id, message.author.username)
					if (register_user['success']) {
						// registered
						message.channel.send(strings['user_is_now_registered'].replace('{user}', tag(message.author.id)));
					} else {
						// already registered
						message.channel.send(strings['user_is_already_registered'].replace('{user}', tag(message.author.id)));
					}
				} else if (args.length == 1) {
					// register tagged user in database
					// check if a user is mentioned in message
					if (message.mentions.users.values().next().value == undefined) {
						message.channel.send(strings['register_no_user_specified']);
						return;
					}
					// register target user
					var targetUser = message.mentions.users.values().next().value.username;
					var targetID = message.mentions.users.values().next().value.id;
					var register_user = await db.registerUser(targetID, targetUser);
					if (register_user['success']) {
						// registered 
						message.channel.send(strings['target_is_now_registered'].replace('{user}', tag(targetID)));
					} else {
						// already registered
						message.channel.send(strings['user_is_already_registered'].replace('{user}', tag(targetID)));
					}
				}
				break;
			case 'compete':
				// sets user competing state to true
				// register user if they're not already in the DB
				await db.registerUser(message.author.id, message.author.username);
				// set the user's competing state to true
				var user_competing = await db.setUserCompeting(message.author.id, true);
				if (user_competing['success']) {
					message.channel.send(strings['user_now_competing'].replace('{user}', tag(message.author.id)));
				}
				break;
			case 'retire':
				// stop competing, but keep data in DB
				// check if user is registered
				var user_exists = await db.checkUserExists(message.author.id);
				if (!user_exists['success'] || !user_exists['exists']) {
					// not registered
					message.channel.send(strings['error_not_registered'].replace('{user}', tag(message.author.id)));
					break;
				}
				// set the user's competing state to false
				var user_competing = await db.setUserCompeting(message.author.id, false);
				if (user_competing['success']) {
					// retired
					message.channel.send(strings['user_no_longer_competing'].replace('{user}', tag(message.author.id)));
				}
				break;
			case 'competing':
				// checks if user is competing
				// check if user is registered
				var user_exists = await db.checkUserExists(message.author.id);
				if (user_exists['success'] && user_exists['exists']) {
					// check if user is currently competing
					var user_competing = await db.isUserCompeting(message.author.id);
					if (user_competing['success'] && user_competing['competing']) {
						// user is competing
						message.channel.send(strings['user_is_competing'].replace('{user}', tag(message.author.id)));
					} else {
						// user is not competing
						message.channel.send(strings['user_is_not_competing'].replace('{user}', tag(message.author.id)));
					}
				} else {
					// not registered
					message.channel.send(strings['error_not_registered'].replace('{user}', tag(message.author.id)));
				}
				break;
			case 'check':
				// checks if user is registered (exists in database)
				if (args.length == 0) {
					// check if user exists in database
					var user_exists = await db.checkUserExists(message.author.id);
					if (user_exists['success'] && user_exists['exists']) {
						// user is registered
						message.channel.send(strings['user_is_registered'].replace('{user}', tag(message.author.id)));
					} else {
						// user is not registered
						message.channel.send(strings['user_is_not_registered'].replace('{user}', tag(message.author.id)));
					}
				} else if (args.length == 1) {
					// check if tagged user is registered
					// if a user is mentioned in message
					if (message.mentions.users.values().next().value != undefined) {
						// check if target user exists in database
						var targetUser = message.mentions.users.values().next().value.username;
						var targetID = message.mentions.users.values().next().value.id;
						var user_exists = await db.checkUserExists(targetID);
						if (user_exists['success'] && user_exists['exists']) {
							// target is registered
							message.channel.send(strings['target_is_registered'].replace('{user}', tag(message.author.id)).replace('{target}', targetUser));
						} else {
							// target is not registered
							message.channel.send(strings['target_is_not_registered'].replace('{user}', tag(message.author.id)).replace('{target}', targetUser));
						}
					}
				}
				break;
			case 'elo':
			case 'rating':
			case 'rank':
			case 'skill':
			case 'sr':
				if (args.length == 0) {
					// gets user elo rating
					// check if user is registered
					var user_exists = await db.checkUserExists(message.author.id);
					if (!user_exists['success'] || !user_exists['exists']) {
						// user is not registered
						message.channel.send(strings['error_not_registered'].replace('{user}', tag(message.author.id)));
						break;
					}

					var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);

					if (!user_id_from_discord_id['success'] || user_id_from_discord_id['id'] == null) {
						// could not get user id from discord id
						message.channel.send('error');
						break;
					}

					// get user elo rating
					var user_elo_rating = await db.getUserEloRating(user_id_from_discord_id['id']);
					if (!user_elo_rating['success']) {
						console.log(user_elo_rating);
						message.channel.send('error');
						break;
					}
					// output user elo rating
					message.channel.send(strings['user_elo'].replace('{user}', tag(message.author.id)).replace('{elo}', user_elo_rating['elo_rating']));
				} else if (args.length == 1) {
					// TODO: check others' SR
				}
				break;
			case 'submit':
				// submits a game result (win/loss)
				// check for a mention
				if (args.length != 1 || message.mentions.users.values().next().value == undefined) {
					message.channel.send(strings['submit_no_user_specified'].replace('{user}', tag(message.author.id)));
					break;
				}

				var target_discord_username = message.mentions.users.values().next().value.username;
				var target_discord_id = message.mentions.users.values().next().value.id;

				// get user id from discord id, checking if the user is registered
				var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
				if (!user_id_from_discord_id['success'] || user_id_from_discord_id['id'] == null) {
					// could not get user id from discord id
					// is the user registered, or do we just not have a discord id in the database?
					log.error('Failed to getUserIdFromDiscordId(' + message.author.id + ')');
					message.channel.send(strings['generic_error']);
					break;
				}

				// check if target is registered
				var target_id_from_discord_id = await db.getUserIdFromDiscordId(target_discord_id);
				if (!target_id_from_discord_id['success'] || target_id_from_discord_id['id'] == null) {
					// could not get target id from discord id
					message.channel.send(strings['error_target_not_registered'].replace('{user}', tag(message.author.id)).replace('{target}', target_discord_username));
					break;
				}

				// get user's latest match vs the target
				var user_latest_match = await db.getUserLatestMatchVs(user_id_from_discord_id['id'], target_id_from_discord_id['id']);

				// if the user's latest match vs the target is not confirmed
				if (user_latest_match['match'] != null && !user_latest_match['match']['confirmed']) {
					var opponent_discord_id = await db.getDiscordIdFromUserId(user_latest_match['match']['opponent_id']);
					// return
					message.channel.send(strings['match_already_submitted'].replace('{user}', tag(message.author.id)).replace('{target}', tag(opponent_discord_id['discord_id'])));
					break;
				}

				// ask the user if they won
				var msg = await message.channel.send(strings['did_you_win'].replace('{user}', tag(message.author.id)));
				// add submission reactions to msg
				// TODO: enumerate emoji reactions
				await msg.react(ReactionEmoji.WIN);
				await msg.react(ReactionEmoji.LOSS);
				// await y/n reaction from user for 60 seconds
				var filter = (reaction, user) => (reaction.emoji.name === ReactionEmoji.WIN || reaction.emoji.name === ReactionEmoji.LOSS) && user.id === message.author.id;
				var collector = msg.createReactionCollector(filter, { time: 60000 });
				// reaction collector
				collector.on('collect', r => {
					async function collect() {
						// user reacted y/n
						await msg.react(ReactionEmoji.CONFIRMED);
						// did the user win the match?
						var result;
						((r['_emoji']['name'] === ReactionEmoji.WIN) ? result = MatchResult.WIN : result = MatchResult.LOSS);
						// submit match result
						await db.submitMatchResult(user_id_from_discord_id['id'], target_id_from_discord_id['id'], !result);
						// ask the target user to confirm the game
						message.channel.send(strings['confirm_game_please'].replace('{target}', tag(target_discord_id)));
					}
					collect().catch((err) => {
						// error collecting reactions
						log.error(err);
					});
				});
				collector.on('end', collected => {
					if (collected.size < 1) {
						// no reactions were collected
						message.channel.send(strings['match_submit_timeout'].replace('{user}', tag(message.author.id)));
					}
				});
				break;
			case 'confirm':
				// check for a target user mention
				if (args.length != 1 || message.mentions.users.values().next().value == undefined) {
					message.channel.send(strings['confirm_no_user_specified'].replace('{user}', tag(message.author.id)));
					break;
				}

				// get user id from discord id
				var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
				if (!user_id_from_discord_id['success'] || user_id_from_discord_id['id'] == null) {
					// failed to get user id from discord id
					message.channel.send(strings['error_not_registered'].replace('{user}', tag(message.author.id)));
					break;
				}

				// get the latest match submission where the user was the opponent
				var opponent_last_match = await db.getOpponentLatestMatch(user_id_from_discord_id['id']);
				if (!opponent_last_match['success'] || opponent_last_match['match'] == null) {
					// failed to get most recent match submission where opponent is the user
					log.error('Failed to getOpponentLatestMatch(' + message.author.id + ')');
					message.channel.send(strings['no_recent_match'].replace('{user}', tag(message.author.id)));
					break;
				}
				var match_id = opponent_last_match['match']['id'];
				var match_player_id = opponent_last_match['match']['player_id'];
				var match_opponent_id = opponent_last_match['match']['opponent_id'];
				var match_result = opponent_last_match['match']['result'] == true;
				var match_confirmed = opponent_last_match['match']['confirmed'] == true;
				// if the most recent match is already confirmed
				if (match_confirmed) {
					message.channel.send(strings['recent_match_confirmed'].replace('{user}', tag(message.author.id)));
					break;
				}
				// get the opponent's latest match
				var discord_id_from_user_id = await db.getDiscordIdFromUserId(match_player_id);
				if (!discord_id_from_user_id['success'] || discord_id_from_user_id['discord_id'] == null) {
					// failed to get discord id from user id
					log.error('Failed to getDiscordIdFromUserId(' + match_player_id + ')');
					message.channel.send(strings['generic_error'].replace('{user}', tag(message.author.id)));
					break;
				}
				if (config.config.rating_method == RatingMethod.ELO) {
					// get user's elo rating
					var userELO = await db.getUserEloRating(match_opponent_id);
					// get target's elo rating
					var targetELO = await db.getUserEloRating(match_player_id);
					var uELO = userELO['elo_rating'];
					var tELO = targetELO['elo_rating'];

					// calculate new elo
					var eloRatingCalculation = eloRating.calculate(uELO, tELO, match_result, config.config.elo_k);
					var newUserELO = eloRatingCalculation['playerRating'];
					var newTargetELO = eloRatingCalculation['opponentRating'];
					// set user's new elo rating
					db.setUserEloRating(match_opponent_id, newUserELO);
					// set target's new elo rating
					db.setUserEloRating(match_player_id, newTargetELO);
					// set confirm the match
					db.setMatchResultConfirmed(match_id, true);

					// message users
					message.channel.send(strings['new_elo_message']
						.replace('{user}', tag(message.author.id))
						.replace('{target}', tag(discord_id_from_user_id['discord_id']))
						.replace('{old_user_elo}', uELO)
						.replace('{new_user_elo}', newUserELO)
						.replace('{old_target_elo}', tELO)
						.replace('{new_target_elo}', newTargetELO));
				}
				break;
		}
	}
	command().catch((err) => {
		log.error(err);
	});
});

// tag a user by userID
function tag(userID) {
	return '<@' + userID + '>';
}

function updateRatings() {
	// just testing, for now.
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
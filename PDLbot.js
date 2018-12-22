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

const MatchResult = { WIN: 1, LOSS: 0 }
const RatingMethod = { elo: 0, glicko2_live: 1, glicko2_schedule: 2 }
exports = MatchResult, RatingMethod;

// called when the bot sees a message
client.on('message', message => {
	// commands start with !
	if (message.content.substring(0, 1) == '!') {
		var args = message.content.substring(1).split(' ');
		const cmd = args[0];
		args = args.splice(1);
		// running the command must be async due to database interactions
		async function command() {
			switch (cmd) {
				case 'debug':
					// debug command for debugging purposes
					// get user data
					const user_data = await db.getUserData(message.author.id);
					if (user_data['success']) {
						// display user data
						var msg = '';
						for (let elem in user_data['data']) {
							msg += elem + ': ' + user_data['data'][elem] + '\n'
							console.log(elem + ': ' + user_data['data'][elem]);
						}
						message.channel.send('```javascript\n' + msg + '```');
					}
					break;
				case 'help':
					// shows help dialogue
					if (args.length == 0) {
						message.channel.send(strings['help']);
					}
					break;
				case 'register':
					// registers user in database
					if (args.length == 0) {
						// register message.author
						const register_user = await db.registerUser(message.author.id, message.author.username)
						if (register_user['success']) {
							// registered
							message.channel.send(strings['user_is_now_registered'].replace('{user}', tag(message.author.id)));
						} else {
							// already registered
							message.channel.send(strings['user_is_already_registered'].replace('{user}', tag(message.author.id)));
						}
					} else if (args.length == 1) {
						// register tagged user in database
						// if a user is mentioned in message
						if (message.mentions.users.values().next().value != undefined) {
							// register target user
							message.channel.send(strings['user_is_now_registered'].replace('{user}', tag(targetID)));
						} else {
							message.channel.send(strings['user_is_already_registered'].replace('{user}', tag(targetID)));
						}
					}
					break;
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
					if (user_exists['success'] && user_exists['exists']) {
						// set the user's competing state to false
						const user_competing = await db.setUserCompeting(message.author.id, false);
						if (user_competing['success']) {
							// retired
							message.channel.send(strings['user_no_longer_competing'].replace('{user}', tag(message.author.id)));
						}
					} else {
						// not registered
						message.channel.send(strings['error_not_registered'].replace('{user}', tag(message.author.id)));
					}
					break;
				case 'competing':
					// checks if user is competing
					// check if user is registered
					var user_exists = await db.checkUserExists(message.author.id);
					if (user_exists['success'] && user_exists['exists']) {
						// check if user is currently competing
						const user_competing = await db.isUserCompeting(message.author.id);
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
						const user_exists = await db.checkUserExists(message.author.id);
						if (user_exists['success'] && user_exists['exists']) {
							// user is registered
							message.channel.send(strings['user_is_registered'].replace('{user}', tag(message.author.id)));
						} else {
							// user is not registered
							message.channel.send(strings['user_is_not_registered'].replace('{user}', tag(message.author.id)));
						}
					} else if (args.length == 1) {
						// check if other user exists in DB
						const targetUser = message.mentions.users.values().next().value.username;
						const targetID = message.mentions.users.values().next().value.id;
						const user_exists = await db.checkUserExists(targetID);
						if (user_exists['success'] && user_exists['exists']) {
							message.channel.send(strings['target_is_registered'].replace('{user}', tag(message.author.id)).replace('{target}', targetUser));
						} else {
							message.channel.send(strings['target_is_not_registered'].replace('{user}', tag(message.author.id)).replace('{target}', targetUser));
						}
					}
					break;
				case 'elo':
				case 'rating':
				case 'skill':
				case 'sr':
					// gets user elo rating
					// check if user is registered
					var user_exists = await db.checkUserExists(message.author.id);
					if (user_exists['success'] && user_exists['exists']) {
						// output user elo rating
						const user_elo_rating = await db.getUserEloRating(message.author.id);
						if (user_elo_rating['success']) {
							message.channel.send(strings['target_is_not_registered'].replace('{user}', tag(message.author.id)).replace('{elo}', user_elo_rating['elo_rating']));
						}
					} else {
						// user is not registered
						message.channel.send(strings['error_not_registered'].replace('{user}', tag(message.author.id)));
					}
					break;
				case 'submit':
					// submits a game result (win/loss)
					if (args.length == 1) {
						// TODO: check if a user is mentioned
						const target_discord_username = message.mentions.users.values().next().value.username;
						const target_discord_id = message.mentions.users.values().next().value.id;
						// check if target is registered
						// TODO: combine with getUserIdFromDiscordId
						const target_exists = await db.checkUserExists(target_discord_id);
						if (target_exists['success'] && target_exists['exists']) {
							// check if user is registered
							// TODO: combine with getUserIdFromDiscordId
							const user_exists = await db.checkUserExists(message.author.id);
							if (user_exists['success'] && user_exists['exists']) {
								// get user id from discord id
								const user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
								if (user_id_from_discord_id['success']) {
									// get user's latest match
									const user_latest_match = await db.getUserLatestMatch(user_id_from_discord_id['id']);
									// if the user doesn't have a most recent match
									if (user_latest_match['match'] == null || user_latest_match['match']['true'] == false) {
										// ask the user if they won
										const msg = await message.channel.send(strings['did_you_win'].replace('{user}', tag(message.author.id)));
										// add submission reactions to msg
										// TODO: enumerate emoji reactions
										await msg.react('✅');
										await msg.react('❎');
										// await y/n reaction from user for 60 seconds
										const filter = (reaction, user) => (reaction.emoji.name === '✅' || reaction.emoji.name === '❎') && user.id === message.author.id;
										const collector = msg.createReactionCollector(filter, { time: 60000 });
										// reaction collector
										collector.on('collect', r => {
											async function collect() {
												// user added reaction
												console.log(r['_emoji']['name']);
												await msg.react('👌');
												// did the user win the match?
												var result;
												((r['_emoji']['name'] === '✅') ? result = MatchResult.WIN : result = MatchResult.LOSS);
												// get the target user's user id from their discord id
												// TODO: get target ID as part of varifying they exist
												const target_id_from_discord_id = await db.getUserIdFromDiscordId(target_discord_id);
												const target_db_id = target_id_from_discord_id['id'];
												// submit match result
												await db.submitMatchResult(user_id_from_discord_id['id'], target_db_id, result);
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

									} else {
										// user has a recent match
										// TODO: allow multiple match submissions at a time
										message.channel.send(strings['no_recent_match'].replace('{user}', tag(message.author.id)));
									}
								} else {
									// failed to get user id from discord id
									log.error('Failed to getUserIdFromDiscordId(' + message.author.id + ')');
									message.channel.send(strings['generic_error']);
								}
							}
						} else {
							// target is not registered
							message.channel.send(strings['error_target_not_registered'].replace('{user}', tag(message.author.id)).replace('{target}', target_discord_username));
						}
					} else {
						// args.length == 0
						message.channel.send(strings['submit_no_user_specified'].replace('{user}', tag(message.author.id)));
					}
					break;
				case 'confirm':
					// check if user exists
					// TODO: combine with getUserIdFromDiscordId
					var user_exists = await db.checkUserExists(message.author.id);
					if (user_exists['success'] && user_exists['exists']) {
						// get user id from discord id
						const user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
						if (user_id_from_discord_id['success']) {
							const user_db_id = user_id_from_discord_id['id'];
							// get the latest match submission where the user was the opponent
							const opponent_last_match = await db.getOpponentLatestMatch(user_db_id);
							if (opponent_last_match['success']) {
								const match_id = opponent_last_match['match']['id'];
								const match_player_id = opponent_last_match['match']['player_id'];
								const match_opponent_id = opponent_last_match['match']['opponent_id'];
								const match_result = opponent_last_match['match']['result'] == true;
								const match_confirmed = opponent_last_match['match']['confirmed'] == true;
								// if the match is not confirmed
								if (!match_confirmed) {
									// get the opponent's latest match
									const discord_id_from_user_id = await db.getDiscordIdFromUserId(match_player_id);
									if (discord_id_from_user_id['success']) {
										const match_player_discord_id = discord_id_from_user_id['discord_id'];
										// update elo
										if (config.rating_method === RatingMethod.elo) {
											// get user's elo rating
											const userELO = await db.getUserEloRating(match_opponent_id);
											// get target's elo rating
											const targetELO = await db.getUserEloRating(match_player_id);
											const uELO = userELO['elo_rating'];
											const tELO = targetELO['elo_rating'];
											// calculate new elo
											const res = eloRating.calculate(uELO, tELO, match_result);

											const newUserELO = res['playerRating'];
											const newTargetELO = res['opponentRating'];
											// set user's new elo rating
											db.setUserEloRating(match_opponent_id, newUserELO);
											// set target's new elo rating
											db.setUserEloRating(match_player_id, newTargetELO);
											// set confirm the match
											db.setMatchResultConfirmed(match_id, true);

											// message users
											message.channel.send(strings['new_elo_message']
												.replace('{user}', tag(message.author.id))
												.replace('{target}', tag(match_player_discord_id))
												.replace('{old_user_elo}', uELO)
												.replace('{new_user_elo}', newUserELO)
												.replace('{old_target_elo}', tELO)
												.replace('{new_target_elo}', newTargetELO));
										}
									} else {
										// failed to get discord id from user id
										log.error('Failed to getDiscordIdFromUserId(' + match_player_id + ')');
										message.channel.send(strings['generic_error'].replace('{user}', tag(message.author.id)));
									}
								} else {
									// most recent match is already confirmed
									message.channel.send(strings['recent_match_confirmed'].replace('{user}', tag(message.author.id)));
								}
							} else {
								// failed to get most recent match submission where opponent is the user
								log.error('Failed to getOpponentLatestMatch(' + message.author.id + ')');
								message.channel.send(strings['no_recent_match'].replace('{user}', tag(message.author.id)));
							}
						} else {
							// failed to get user id from discord id
							log.error('Failed to getUserIdFromDiscordId(' + message.author.id + ')')
							message.channel.send(strings['generic_error'].replace('{user}', tag(message.author.id)));
						}
					} else {
						// user isn't registered
						message.channel.send(strings['error_not_registered'].replace('{user}', tag(message.author.id)));
					}
					break;
			}
		}
		command().catch((err) => {
			log.error(err);
		});
	}
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
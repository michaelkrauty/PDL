const discord = require('discord.js');
const glicko2 = require('glicko2');
const eloRating = require('elo-rating');
const log = require('winston');

const auth = require('./auth.json');
const config = require('./config.js').config;
const db = require('./database.js');
const user = require('./user.js');
const strings = require('./strings.js');
const fm = require('./filemanager.js');
const package = require('./package.json');

var discord_channels_to_use;
var admin_discord_ids;
var started = false;

const MatchResult = { WIN: 1, LOSS: 0 };
const RatingMethod = { ELO: 0, GLICKO2_LIVE: 1, GLICKO2_SCHEDULE: 2 };
const ReactionEmoji = { WIN: '✅', LOSS: '❎', CONFIRMED: '👌', WIN_CONFIRM: '🆗', LOSS_CONFIRM: '❌' };
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
client.once('ready', async () => {
	log.info(`Starting ${client.user.username} v${package.version} - (${client.user.id})`);
	// setup json storage files
	await fm.checkFile('./channels.json');
	discord_channels_to_use = require('./channels.json').data;
	await fm.checkFile('./admins.json');
	admin_discord_ids = require('./admins.json').data;
	// connect to database
	await db.connect();
	// startup complete
	started = true;
	// announce startup
	// for (var e in discord_channels_to_use) {
	// 	client.channels.get(discord_channels_to_use[e]).send(`Started ${client.user.username} v${package.version}`);
	// }
});

// called when the bot sees a message
client.on('message', async (message) => {
	// check if the bot is ready to handle commands
	if (!started)
		return;
	// commands start with !
	if (message.content.substring(0, 1) != '!')
		return;
	// set variables
	var args = message.content.substring(1).split(' ');
	const cmd = args[0];
	var admin = admin_discord_ids.includes(message.author.id);
	args = args.splice(1);
	// init command, to initialize a channel for use by the bot
	if (cmd == 'init') {
		// requires admin
		if (!admin)
			return;
		// loop through channels, check if current channel is already added
		var channels = discord_channels_to_use;
		if (channels != undefined) {
			if (channels.includes(message.channel.id)) {
				message.channel.send(`Already using channel ${message.channel.id}:${message.channel.name}`);
				return;
			}
			// add current channel to channels list
			channels.push(message.channel.id);
		} else
			// add current channel to channels list
			channels = [message.channel.id];
		// write data to file
		await fm.writeFile('./channels.json', JSON.stringify({ data: channels }), (err) => {
			log.error(err);
		});
		discord_channels_to_use = require('./channels.json').data;
		// success, list channels
		var msg = 'Success, using channels: \n';
		for (i = 0; i < discord_channels_to_use.length; i++) {
			msg += `${discord_channels_to_use[i]}:${client.channels.get(discord_channels_to_use[i])}\n`;
		}
		message.channel.send(msg);
		return;
	}
	// is the channel being used by the bot?
	if (!discord_channels_to_use.includes(message.channel.id))
		return;
	switch (cmd) {
		// test command, for testing stuff
		case 'test':
			var user = require('./user.js');
			var usr = await new user.User(1);
			console.log(await usr.getElo());
			break;
		// version command, shows current bot version
		case 'version':
			message.channel.send(`${client.user.username} v${package.version}`);
			break;
		// channels command, shows channels being used by bot
		case 'channels':
			// requires admin
			if (!admin)
				break;
			// list channels
			var msg = '';
			for (i = 0; i < discord_channels_to_use.length; i++) {
				msg += `${discord_channels_to_use[i]}:${client.channels.get(discord_channels_to_use[i])}\n`;
			}
			message.channel.send(msg);
			break;
		// deinit command, makes the bot stop using a channel
		case 'deinit':
			// requires admin
			if (!admin)
				break;
			// check if channel is being used currently
			var channels = discord_channels_to_use;
			if (channels == undefined || !channels.includes(message.channel.id)) {
				message.channel.send(`Currently not using channel ${message.channel.id}:${message.channel.name}`);
				break;
			}
			// stop using this channel
			channels.splice(channels.indexOf(message.channel.id), 1);
			await fm.writeFile('./channels.json', JSON.stringify({ data: channels }), (err) => {
				log.error(err);
			});
			discord_channels_to_use = require('./channels.json').data;
			// list channels
			var msg = 'Success, using channels: \n';
			for (i = 0; i < discord_channels_to_use.length; i++) {
				msg += `${discord_channels_to_use[i]}:${client.channels.get(discord_channels_to_use[i])}\n`;
			}
			message.channel.send(msg);
			break;
		// TODO: remove this command before release, for debug only
		// say command, makes the bot say a message
		case 'say':
			// construct and send message
			var msg = '';
			for (i = 0; i < args.length; i++) {
				((i - 1 < args.length) ? msg += args[i] + ' ' : msg += args[i]);
			}
			message.channel.send(msg);
			break;
		// TODO: remove this command before release, for debug only
		// debug command, displays user data
		case 'debug':
			// mention
			var mention = message.mentions.users.values().next().value;
			// require admin and 1 argument
			if (admin && args.length == 1 && mention != undefined) {
				// get mention user id
				var mention_id = await db.getUserIdFromDiscordId(mention.id);
				if (!mention_id) {
					// target is not registered
					message.channel.send(`${tag(message.author.id)} no data to display.`);
					break;
				}
				// get mention data
				var mention_data = await db.getUserDataUsingId(mention_id);
				if (!mention_data) {
					message.channel.send(`${tag(message.author.id)} no data to display.`);
					break;
				}
				// compose and send message containing user data
				var msg = '';
				for (var elem in mention_data) {
					msg += `${elem}: ${mention_data[elem]}\n`;
				}
				message.channel.send(`${tag(message.author.id)}\n\`\`\`javascript\n${msg}\`\`\``);
				break;
			}
			// get user data
			var user_data = await db.getUserData(message.author.id);
			if (!user_data) {
				message.channel.send(`${tag(message.author.id)} no data to display.`);
				break;
			}
			// compose and send message containing user data
			var msg = '';
			for (var elem in user_data) {
				msg += `${elem}: ${user_data[elem]}\n`;
			}
			message.channel.send(`${tag(message.author.id)}\n\`\`\`javascript\n${msg}\`\`\``);
			break;
		// help command, shows help dialogue
		case 'help':
			msg = strings.help;
			if (admin) msg += `\n${strings.admin_help}`;
			message.channel.send(msg.replaceAll('{user}', tag(message.author.id)));
			break;
		// challengeme command, toggles challengeme rank
		case 'challengeme':
			// get challengeme role
			let challengeme = await message.guild.roles.find(role => role.name === "challengeme");
			if (challengeme.id == undefined) {
				message.channel.send(`${tag(message.author.id)} could not find role challengeme.`);
				break;
			}
			// toggle challengeme role on/off
			if (message.member._roles.includes(challengeme.id)) {
				// toggle off
				message.member.removeRole(challengeme);
				message.channel.send(`${tag(message.author.id)} no longer has role challengeme.`);
			} else {
				// toggle on
				message.member.addRole(challengeme);
				message.channel.send(`${tag(message.author.id)} now has role challengeme.`);
			}
			break;
		// challenging command, shows users with challengeme rank
		case 'challenging':
			break;
		// questme command, toggles questme rank
		case 'questme':
			// get questme role
			let questme = await message.guild.roles.find(role => role.name === "questme");
			if (questme.id == undefined) {
				message.channel.send(`${tag(message.author.id)} could not find role questme.`);
				break;
			}
			// toggle questme role on/off
			if (message.member._roles.includes(questme.id)) {
				// toggle off
				message.member.removeRole(questme);
				message.channel.send(`${tag(message.author.id)} no longer has role questme.`);
			} else {
				// toggle on
				message.member.addRole(questme);
				message.channel.send(`${tag(message.author.id)} now has role questme.`);
			}
			break;
		// questing command, shows users with questme rank
		case 'questing':
			break;
		// compete command, registers the user in the database and/or enables competing for the user
		case 'register':
		case 'compete':
			// require no arguments
			if (args.length != 0) {
				message.channel.send(strings.compete_try_again.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// register user if they're not already in the DB
			await db.registerUser(message.author.id, message.author.username);
			// check if the user is currently competing
			var user_competing = await db.isUserCompeting(message.author.id);
			if (user_competing) {
				message.channel.send(`${tag(message.author.id)} already competing in PDL.`);
				break;
			}
			// set the user's competing state to true
			await db.setUserCompeting(message.author.id, true);
			message.channel.send(strings.user_now_competing.replaceAll('{user}', tag(message.author.id)));
			break;
		// quit command, disables competing for the user
		case 'retire':
		case 'quit':
			// check if user is registered
			var user_exists = await db.checkUserExists(message.author.id);
			if (!user_exists) {
				// not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// check if the user is currently competing
			var user_competing = await db.isUserCompeting(message.author.id);
			if (!user_competing) {
				message.channel.send(`${tag(message.author.id)} compete with !compete`);
				break;
			}
			// set the user's competing state to false
			var user_competing = await db.setUserCompeting(message.author.id, false);
			if (user_competing)
				// retired
				message.channel.send(strings.user_no_longer_competing.replaceAll('{user}', tag(message.author.id)));
			break;
		// competing command, shows if user is competing or not
		case 'competing':
			// check if user is registered
			var user_exists = await db.checkUserExists(message.author.id);
			if (!user_exists) {
				// not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// check if user is currently competing
			var user_competing = await db.isUserCompeting(message.author.id);
			user_competing ?
				message.channel.send(strings.user_is_competing.replaceAll('{user}', tag(message.author.id))) :
				message.channel.send(strings.user_is_not_competing.replaceAll('{user}', tag(message.author.id)));
			break;
		// check command, shows if user is registered in the database
		case 'check':
			if (args.length == 0) {
				// check if user is registered
				var user_exists = await db.checkUserExists(message.author.id);
				user_exists ?
					message.channel.send(strings.user_is_registered.replaceAll('{user}', tag(message.author.id))) :
					message.channel.send(strings.user_is_not_registered.replaceAll('{user}', tag(message.author.id)));
			} else if (args.length == 1) {
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions
					message.channel.send(strings.submit_no_user_specified.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// check if target is registered
				var mention_exists = await db.checkUserExists(mention.id);
				if (!mention_exists) {
					// target is not registered
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					break;
				}
				// target is registered
				message.channel.send(strings.target_is_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
			}
			break;
		// oldsr command, shows rank and skill rating (deprecated)
		case 'oldsr':
			if (args.length == 0) {
				// gets user skill rating
				// get user id from discord id
				var user_id = await db.getUserIdFromDiscordId(message.author.id);
				if (!user_id) {
					// user is not registered
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// get user skill rating
				var user_elo = await db.getUserEloRating(user_id);
				if (!user_elo) {
					message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
					log.error(`Could not getUserEloRating(${user_id}, true)`);
					break;
				}
				// get user elo rank
				var user_rank = await db.getUserEloRanking(user_id);
				if (!user_rank) {
					message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
					log.error(`Could not getUserEloRanking(${user_id}, true)`);
					break;
				}
				// output user skill rating
				message.channel.send(strings.user_skill_rating.replaceAll('{user}', tag(message.author.id)).replaceAll('{skill_rating}', user_elo).replaceAll('{user_rank}', user_rank));
			} else if (args.length == 1) {
				// gets other user's skill rating
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions
					message.channel.send(strings.submit_no_user_specified.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// get target user id
				var target_id = await db.getUserIdFromDiscordId(mention.id);
				if (!target_id) {
					// target is not registered
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					break;
				}
				// get target skill rating
				var target_elo = await db.getUserEloRating(target_id);
				if (!target_elo) {
					// failed to get user elo rating
					log.error(`Could not getUserEloRating(${target_id})`);
					message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// output target skill rating
				message.channel.send(strings.target_skill_rating.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username).replaceAll('{elo}', target_elo));
			}
			break;
		// elo command, shows user rank and elo, plus 2 users above rank and 2 users below rank
		case 'elo':
		case 'rating':
		case 'rank':
		case 'skill':
		case 'sr':
		case 'sr2':
			// TODO: add !sr <player>
			// get user id from discord id
			var user_id = await db.getUserIdFromDiscordId(message.author.id);
			if (!user_id) {
				// user is not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// get player and nearby players
			var nearby_players = await db.getNearbyPlayers(user_id, 2);
			if (nearby_players == null || nearby_players.length < 1) {
				// failed to get similarly ranked players
				message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
				log.error(`could not getNearbyPlayers(${user_id}, 2)`);
				break;
			}
			// find the user in the list
			nearby_players.sort(function (a, b) {
				return !(a.elo_rating > b.elo_rating);
			});
			var player_index = 0;
			for (i = 0; i < nearby_players.length; i++) {
				if (nearby_players[i].id == user_id)
					player_index = i;
			}
			// construct message
			var msg = '';
			for (i = 0; i < nearby_players.length; i++) {
				// do nothing if not within 2 above and 2 below the player
				if (i < player_index - 2 || i > player_index + 2)
					continue;
				// get user elo rank
				var rank = await db.getUserEloRanking(nearby_players[i].id);
				if (!rank) {
					// failed to get similarly ranked players
					message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
					log.error(`Could not getUserEloRanking(${nearby_players[i].id})`);
					break;
				}
				// list top players
				var username = nearby_players[i].discord_username;
				if (nearby_players[i].id == user_id)
					username = `**${username}**`;
				msg += `${rank}. ${username}: ${nearby_players[i].elo_rating} ELO\n`;

			}
			message.channel.send(msg);
			break;
		// pending command, shows pending match submissions
		case 'confirmations':
		case 'pending':
			if (args.length == 0) {
				// show pending match submissions vs the user
				// get user id from discord id, checking if the user is registered
				var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
				if (!user_id_from_discord_id) {
					// could not get user id from discord id
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// get user's recent matches
				var latest_matches = await db.getUserLatestMatches(user_id_from_discord_id);
				if (!latest_matches) {
					// no recent unconfirmed matches
					message.channel.send(strings.no_unconfirmed_matches.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', message.author.username));
					break;
				}
				// compose response message
				var text = '';
				// loop through retrieved matches
				var waiting_for_input = false;
				// ensure only one response from the user per message
				var collected = [];
				// ties message id to match id
				var user_pending_matches = new Map();
				for (var m in latest_matches) {
					var match = latest_matches[m];
					// was the submitter the user?
					var submitter_was_user;
					match.player_id == user_id_from_discord_id ? submitter_was_user = true : submitter_was_user = false;
					// get the other player's user id
					var opponent_id;
					(submitter_was_user ? opponent_id = match.opponent_id : opponent_id = match.player_id);
					// create a string of the match result (win/loss)
					var match_result_string;
					(match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss');
					// get opponent user data
					var opponent_data = await db.getUserDataUsingId(opponent_id);
					if (!opponent_data) {
						// could not get the other player's data from their user id
						log.error(`Could not getUserDataUsingId(${opponent_id})`);
						message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
						break;
					}
					// compose message with match id, tag the author, show other player's name in plaintext (no tag)
					text = '';
					(submitter_was_user ?
						text += `${tag(message.author.id)} submitted a **${match_result_string}** vs **${opponent_data.discord_username}** in Game ${match.id}\n` :
						text += `**${opponent_data.discord_username}** submitted a **${match_result_string}** vs ${tag(message.author.id)} in Game ${match.id}\n`);
					// send it
					var msg = await message.channel.send(text);
					// if the submitter was the user, no emojis necessary.
					if (submitter_was_user)
						continue;
					// ask the user if they won
					waiting_for_input = true;
					// ensure no multiple reactions
					user_pending_matches.set(msg.id, match.id);
					// add submission reactions to msg
					await msg.react(ReactionEmoji.WIN);
					await msg.react(ReactionEmoji.LOSS);
					// await y/n reaction from user for 60 seconds
					var filter = (reaction, user) => (reaction.emoji.name === ReactionEmoji.WIN || reaction.emoji.name === ReactionEmoji.LOSS) && user.id === message.author.id;
					var collector = msg.createReactionCollector(filter, { time: 60000 });
					// collect reactions
					collector.on('collect', r => {
						async function collect() {
							// already got a response from the user
							if (collected.includes(r.message.id))
								return;
							// user reacted y/n
							collected.push(r.message.id);
							// confirm or dispute?
							var confirm;
							if (r._emoji.name === ReactionEmoji.WIN) {
								await r.message.react(ReactionEmoji.WIN_CONFIRM);
								confirm = MatchResult.WIN;
							} else {
								await r.message.react(ReactionEmoji.LOSS_CONFIRM);
								confirm = MatchResult.LOSS;
							}
							// get match id
							var match_id = user_pending_matches.get(r.message.id);
							if (!match_id) {
								log.error(`Could not get match ${r.message.id}`);
								return;
							}
							// get match
							var match = await db.getMatch(match_id);
							if (!match) {
								log.error(`Could not getMatch(${match_id})`);
								return;
							}
							// get opponent data
							var opponent_data = await db.getUserDataUsingId(match.player_id);
							if (!opponent_data) {
								log.error(`Could not getUserDataUsingId(${match.player_id})`);
								return;
							}
							if (!confirm) {
								// the match was disputed
								await r.message.react(ReactionEmoji.LOSS);
								await r.message.channel.send(`${tag(message.author.id)} disputes match ${match_id} vs ${tag(opponent_data.discord_id)} ${tagRole(message.guild.roles.find(role => role.name === "admin").id)}`);
							} else {
								// the match was confirmed
								await r.message.react(ReactionEmoji.WIN);
								if (config.rating_method == RatingMethod.ELO) {
									// get player's elo rating
									var playerElo = await db.getUserEloRating(match.player_id);
									if (!playerElo) {
										log.error(`Could not getUserEloRating(${match.player_id})`);
										return;
									}
									// get opponent's elo rating
									var opponentElo = await db.getUserEloRating(match.opponent_id);
									if (!opponentElo) {
										log.error(`Could not getUserEloRating(${match.opponent_id})`);
										return;
									}
									// calculate new elo
									var eloRatingCalculation = calculateElo(playerElo, opponentElo, match.result);
									var newPlayerElo = eloRatingCalculation.playerRating + config.bonus_elo;
									var newOpponentElo = eloRatingCalculation.opponentRating + config.bonus_elo;
									// set player's new elo rating
									await db.setUserEloRating(match.player_id, newPlayerElo);
									// set target's new elo rating
									await db.setUserEloRating(match.opponent_id, newOpponentElo);
									// update the match info
									await db.updateMatch(match.id, true, playerElo, newPlayerElo, opponentElo, newOpponentElo);
									// get player's new rank
									var player_rank = await db.getUserEloRanking(match.player_id);
									if (!player_rank) {
										log.error(`Could not getUserEloRanking(${match.player_id})`);
										return;
									}
									// get opponent's new rank
									var opponent_rank = await db.getUserEloRanking(match.opponent_id);
									if (!opponent_rank) {
										log.error(`Could not getUserEloRanking(${match.opponent_id})`);
										return;
									}
									// get player data
									var player_data = await db.getUserDataUsingId(match.player_id);
									if (!player_data) {
										log.error(`Could not getUserDataUsingId(${match.player_id})`);
									}
									// get opponent data
									var opponent_data = await db.getUserDataUsingId(match.opponent_id);
									if (!opponent_data) {
										log.error(`Could not getUserDataUsingId(${match.opponent_id})`);
									}
									// message players
									var winloss;
									match.result ? winloss = 'win' : winloss = 'loss';
									str = `${tag(message.author.id)} confirmed game ${match.id}.\n${strings.new_elo_message
										.replaceAll('{game_id}', match.id)
										.replaceAll('{winloss}', winloss)
										.replaceAll('{user}', tag(message.author.id))
										.replaceAll('{player}', tag(player_data.discord_id))
										.replaceAll('{opponent}', tag(opponent_data.discord_id))
										.replaceAll('{player_name}', player_data.discord_username)
										.replaceAll('{opponent_name}', opponent_data.discord_username)
										.replaceAll('{player_elo_rank}', player_rank)
										.replaceAll('{opponent_elo_rank}', opponent_rank)
										.replaceAll('{old_player_elo}', playerElo)
										.replaceAll('{new_player_elo}', newPlayerElo)
										.replaceAll('{old_opponent_elo}', opponentElo)
										.replaceAll('{new_opponent_elo}', newOpponentElo)}`;
									await message.channel.send(str);
								}
							}
							user_pending_matches.delete(r.message.id);
							await r.message.react(ReactionEmoji.CONFIRMED);
						}
						collect().catch((err) => {
							// error collecting reactions
							log.error(err);
						});
					});
					collector.on('end', collected => {
						if (collected.size < 1) {
							// no y/n reaction was collected
							message.channel.send(strings.pending_submit_timeout.replaceAll('{user}', tag(message.author.id)));
							user_pending_matches.delete(msg.id);
						}
					});

				}
				// a match has confirm and dispute options
				if (waiting_for_input) {
					message.channel.send(`${tag(message.author.id)} Use the check to confirm, or X to dispute.`);
				}
			} else if (args.length == 1 && admin) {
				// admins can confirm or reject other users' pending games
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions, too many arguments
					message.channel.send(strings.pending_no_user_specified.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// get target user id from target discord id, checking if the target is registered
				var target_id_from_discord_id = await db.getUserIdFromDiscordId(mention.id);
				if (!target_id_from_discord_id) {
					// could not get target user id from discord id
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id).replaceAll('{target}', mention.username)));
					break;
				}
				// get user id from discord id, checking if the user is registered
				// TODO: getUser (user object?)
				var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
				if (!user_id_from_discord_id) {
					// could not get user id from discord id
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// get target's recent matches
				var target_latest_matches = await db.getUserLatestMatches(target_id_from_discord_id);
				if (!target_latest_matches) {
					// no recent unconfirmed matches
					message.channel.send(strings.no_unconfirmed_matches.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					break;
				}
				// compose response message
				var msg = tag(message.author.id) + '\n';
				// loop through the target's latest matches
				for (var m in target_latest_matches) {
					var match = target_latest_matches[m];
					// get the other player's user id
					var opponent_id;
					var match_submitted_by_target = match.player_id == target_id_from_discord_id;
					match_submitted_by_target ?
						opponent_id = match.opponent_id :
						opponent_id = match.player_id;
					// match result ? 'win' : 'loss'
					var match_result_string;
					(match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss');
					// get the other player's discord id using their user id
					// get the opponent's user data
					var opponent_data = await db.getUserDataUsingId(opponent_id);
					if (!opponent_data) {
						// could not get the other player's data from their user id
						log.error(`Could not getUserDataUsingId(${opponent_id})`);
						message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
						break;
					}
					// tag the opponent if it's the author, else don't tag them
					var opponent_username;
					(opponent_data.discord_id == message.author.id ?
						opponent_username = tag(message.author.id) :
						opponent_username = opponent_data.discord_username);
					// construct message
					msg += `Game ${match.id}: `;
					match_submitted_by_target ? msg += mention.username : msg += opponent_username;
					msg += ` submitted a ${match_result_string} vs `;
					match_submitted_by_target ? msg += opponent_username : msg += mention.username;
					msg += '\n';
				}
				message.channel.send(msg);
			}
			break;
		// submit command, submits a match result vs another user
		case 'submit':
			// get user id from discord id, checking if the user is registered
			var user_id = await db.getUserIdFromDiscordId(message.author.id);
			if (!user_id) {
				// could not get user id from discord id
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// check for a mention
			var mention = message.mentions.users.values().next().value;
			if (args.length != 1 || mention == undefined || mention.id == message.author.id) {
				// no mentions, too many arguments, or user mentioned self
				message.channel.send(strings.submit_no_user_specified.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// get mention data
			var mention_data = await db.getUserData(mention.id);
			if (!mention_data) {
				// mention is not registered
				message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
				break;
			}
			// check if mention is competing
			if (!mention_data.competing) {
				// mention is not competing
				message.channel.send(strings.target_is_not_competing.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
				break;
			}
			// get recent matches of user and mention of the week
			var arr = [];
			var num_matches = 0;
			// get the user's latest matches of the week
			var user_latest_matches = await db.getUserLatestMatchesOfWeek(user_id);
			if (!user_latest_matches)
				user_latest_matches.length = 0;
			else for (var e in user_latest_matches) {
				arr.push(user_latest_matches[e].id);
				num_matches++;
			}
			// get the mention's latest matches of the week
			var mention_latest_matches = await db.getUserLatestMatchesOfWeek(mention_data.id);
			if (!mention_latest_matches)
				mention_latest_matches.length = 0;
			else for (var e in user_latest_matches) {
				if (!arr.includes(mention_latest_matches[e].id)) {
					arr.push(mention_latest_matches[e].id);
					num_matches++;
				}
			}
			// get the amount of matches the user has played within the last week
			if (num_matches >= config.maximum_weekly_challenges) {
				// user has already played the maximum amount of matches for the week
				message.channel.send(`You have recorded the maximum number of matches for the week (${config.maximum_weekly_challenges}). Match limit reset on Sundays at 11:59pm PST`);
				break;
			}
			// ask the user if they won
			var msg = await message.channel.send(strings.did_you_win.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
			// add submission reactions to msg
			await msg.react(ReactionEmoji.WIN);
			await msg.react(ReactionEmoji.LOSS);
			// await y/n reaction from user for 60 seconds
			var filter = (reaction, user) => (reaction.emoji.name === ReactionEmoji.WIN || reaction.emoji.name === ReactionEmoji.LOSS) && user.id === message.author.id;
			var collector = msg.createReactionCollector(filter, { time: 60000 });
			// reaction collector
			var collected = [];
			collector.on('collect', r => {
				async function collect() {
					if (collected.includes(r.message.id))
						return;
					collected.push(r.message.id);
					// user reacted y/n
					// did the user win the match?
					var result;
					((r._emoji.name === ReactionEmoji.WIN) ? result = MatchResult.WIN : result = MatchResult.LOSS);
					// get user data
					var user_data = await db.getUserData(message.author.id);
					if (!user_data) {
						// could not get user data
						message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
						return;
					}
					// get player's elo rating
					var playerElo = await db.getUserEloRating(user_data.id);
					if (!playerElo) {
						log.error(`Could not getUserEloRating(${user_data.id})`);
						return;
					}
					// get opponent's elo rating
					var opponentElo = await db.getUserEloRating(mention_data.id);
					if (!opponentElo) {
						log.error(`Could not getUserEloRating(${mention_data.id})`);
						return;
					}
					// submit match result
					await db.submitMatchResult(user_data.id, mention_data.id, (result == MatchResult.WIN), playerElo, opponentElo, null, null);
					// ask the target user to confirm the game
					message.channel.send(strings.confirm_game_please.replaceAll('{target}', tag(mention.id)).replaceAll('{user}', message.author.username).replaceAll('{game_id}'));
					collector.stop();
					msg.react(ReactionEmoji.CONFIRMED);
				}
				collect().catch((err) => {
					// error collecting reactions
					log.error(err);
				});
			});
			collector.on('end', collected => {
				if (collected.size < 1) {
					// no y/n reaction was collected
					message.channel.send(strings.match_submit_timeout.replaceAll('{user}', tag(message.author.id)));
				}
			});
			break;
		// matchinfo command, allows admins to see match information with match id
		case 'info':
		case 'matchinfo':
			if (args.length != 1 || !admin)
				break;
			var match = await db.getMatch(args[0]);
			if (!match)
				break;
			var msg = '';
			for (var e in match) {
				msg += `${e}: ${match[e]}\n`;
			}
			message.channel.send(`\`\`\`${msg}\`\`\``);
			break;
		// confirm command, allows admins to manually confirm pending matches with match id
		case 'confirm':
			// require admin and one argument
			if (args.length != 1 || !admin)
				break;
			// get match info
			var match = await db.getMatch(args[0]);
			if (!match) {
				message.channel.send(`No match found with ID ${args[0]} `);
				break;
			}
			// get player data
			var player_data = await db.getUserDataUsingId(match.player_id);
			if (!player_data) {
				log.error(`Could not getUserDataUsingId(${match.player_id})`);
			}
			// get opponent data
			var opponent_data = await db.getUserDataUsingId(match.opponent_id);
			if (!opponent_data) {
				log.error(`Could not getUserDataUsingId(${match.opponent_id})`);
			}
			// is the match already confirmed?
			if (match.confirmed) {
				message.channel.send(`Game ${match.id} is already confirmed.`);
				break;
			}
			// get player's elo rating
			var playerElo = await db.getUserEloRating(match.player_id);
			if (!playerElo) {
				log.error(`Could not getUserEloRating(${match.player_id})`);
				break;
			}
			// get opponent's elo rating
			var opponentElo = await db.getUserEloRating(match.opponent_id);
			if (!opponentElo) {
				log.error(`Could not getUserEloRating(${match.opponent_id})`);
				break;
			}
			// calculate new elo
			var newPlayerElo = playerElo;
			var newOpponentElo = opponentElo;
			if (match.player_start_elo != null && match.opponent_start_elo != null) {
				// match has players' start elo
				if (match.player_end_elo != null && match.opponent_end_elo != null) {
					// match has players' end elo
					if (match.result) {
						// player won game
						newPlayerElo = playerElo + Math.abs(match.player_end_elo - match.player_start_elo);
						newOpponentElo = opponentElo - Math.abs(match.opponent_start_elo - match.opponent_end_elo);
					} else {
						// player lost game
						newPlayerElo = playerElo - Math.abs(match.player_start_elo - match.player_end_elo);
						newOpponentElo = opponentElo + Math.abs(match.opponent_end_elo - match.opponent_start_elo);
					}
				} else {
					// match has players' start elo, but not end elo
					var elo = calculateElo(match.player_start_elo, match.opponent_start_elo, match.result);
					if (match.result) {
						// player won game
						newPlayerElo = playerElo + Math.abs(elo.playerRating - match.player_start_elo) + config.bonus_elo;
						newOpponentElo = opponentElo - Math.abs(match.opponent_start_elo - elo.opponentRating) + config.bonus_elo;
					} else {
						// player lost game
						newPlayerElo = playerElo - Math.abs(elo.playerRating - match.player_start_elo) + config.bonus_elo;
						newOpponentElo = opponentElo + Math.abs(match.opponent_start_elo - elo.opponentRating) + config.bonus_elo;
					}
				}
			} else {
				// no start elo in match, calculate new elo
				var elo = calculateElo(playerElo, opponentElo, match.result);
				newPlayerElo = elo.playerRating + config.bonus_elo;
				newOpponentElo = elo.opponentRating + config.bonus_elo;
			}
			// set player's new elo rating
			await db.setUserEloRating(match.player_id, newPlayerElo);
			// set target's new elo rating
			await db.setUserEloRating(match.opponent_id, newOpponentElo);
			await db.updateMatch(match.id, true, playerElo, newPlayerElo, opponentElo, newOpponentElo);
			// get player's new rank
			var player_rank = await db.getUserEloRanking(match.player_id);
			if (!player_rank) {
				log.error(`Could not getUserEloRanking(${match.player_id})`);
				break;
			}
			// get opponent's new rank
			var opponent_rank = await db.getUserEloRanking(match.opponent_id);
			if (!opponent_rank) {
				log.error(`Could not getUserEloRanking(${match.opponent_id})`);
				break;
			}
			// message players
			var winloss;
			match.result ? winloss = 'win' : winloss = 'loss';
			msg = `${tag(message.author.id)} confirmed game ${match.id}.\n`;
			msg += strings.new_elo_message
				.replaceAll('{game_id}', match.id)
				.replaceAll('{winloss}', winloss)
				.replaceAll('{user}', tag(message.author.id))
				.replaceAll('{player}', tag(player_data.discord_id))
				.replaceAll('{opponent}', tag(opponent_data.discord_id))
				.replaceAll('{player_name}', player_data.discord_username)
				.replaceAll('{opponent_name}', opponent_data.discord_username)
				.replaceAll('{player_elo_rank}', player_rank)
				.replaceAll('{opponent_elo_rank}', opponent_rank)
				.replaceAll('{old_player_elo}', playerElo)
				.replaceAll('{new_player_elo}', newPlayerElo)
				.replaceAll('{old_opponent_elo}', opponentElo)
				.replaceAll('{new_opponent_elo}', newOpponentElo);
			await message.channel.send(msg);
			break;
		// cancel command, allows admins to nullify a pending match with match id
		case 'cancel':
			// require admin and one argument
			if (args.length != 1 || !admin)
				break;
			// get match info
			var match = await db.getMatch(args[0]);
			if (!match) {
				message.channel.send(`No match found with ID ${args[0]} `);
				break;
			}
			// get player data
			var player_data = await db.getUserDataUsingId(match.player_id);
			if (!player_data) {
				log.error(`Could not getUserDataUsingId(${match.player_id})`);
				break;
			}
			// get opponent data
			var opponent_data = await db.getUserDataUsingId(match.opponent_id);
			if (!opponent_data) {
				log.error(`Could not getUserDataUsingId(${match.opponent_id})`);
				break;
			}
			// is the match already confirmed?
			if (!match.confirmed) {
				message.channel.send(`Game ${match.id} is not confirmed.`);
				break;
			}
			// get player's elo rating
			var playerElo = await db.getUserEloRating(match.player_id);
			if (!playerElo) {
				log.error(`Could not getUserEloRating(${match.player_id})`);
				break;
			}
			// get opponent's elo rating
			var opponentElo = await db.getUserEloRating(match.opponent_id);
			if (!opponentElo) {
				log.error(`Could not getUserEloRating(${match.opponent_id})`);
				break;
			}
			// revert elo gained/lost as a result of this game
			var newPlayerElo;
			var newOpponentElo;
			if (match.result) {
				newPlayerElo = playerElo - Math.abs(match.player_end_elo - match.player_start_elo);
				newOpponentElo = opponentElo + Math.abs(match.opponent_start_elo - match.opponent_end_elo);
			} else {
				newPlayerElo = playerElo + Math.abs(match.player_start_elo - match.player_end_elo);
				newOpponentElo = opponentElo - Math.abs(match.opponent_end_elo - match.opponent_start_elo);
			}
			// set player's new elo rating
			await db.setUserEloRating(match.player_id, newPlayerElo);
			// set target's new elo rating
			await db.setUserEloRating(match.opponent_id, newOpponentElo);
			// update the match info
			await db.setMatchResultConfirmed(match.id, false);
			// get player's new rank
			var player_rank = await db.getUserEloRanking(match.player_id);
			if (!player_rank) {
				message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
				log.error(`Could not getUserEloRanking(${match.player_id})`);
				break;
			}
			// get opponent's new rank
			var opponent_rank = await db.getUserEloRanking(match.opponent_id);
			if (!opponent_rank) {
				message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
				log.error(`Could not getUserEloRanking(${match.opponent_id})`);
				break;
			}
			// message players
			var winloss;
			match.result ? winloss = 'win' : winloss = 'loss';
			msg = `${tag(message.author.id)} cancelled game ${match.id}.\n`;
			msg += strings.new_elo_message
				.replaceAll('{game_id}', match.id)
				.replaceAll('{winloss}', winloss)
				.replaceAll('{user}', tag(message.author.id))
				.replaceAll('{player}', tag(player_data.discord_id))
				.replaceAll('{opponent}', tag(opponent_data.discord_id))
				.replaceAll('{player_name}', player_data.discord_username)
				.replaceAll('{opponent_name}', opponent_data.discord_username)
				.replaceAll('{player_elo_rank}', player_rank)
				.replaceAll('{opponent_elo_rank}', opponent_rank)
				.replaceAll('{old_player_elo}', playerElo)
				.replaceAll('{new_player_elo}', newPlayerElo)
				.replaceAll('{old_opponent_elo}', opponentElo)
				.replaceAll('{new_opponent_elo}', newOpponentElo);
			await message.channel.send(msg);
			break;
		// top command, shows top 25 competing players by elo
		case 'top':
			if (args.length != 0)
				break;
			// get top players
			var top_players = await db.getTopCompetingPlayers(25);
			if (!top_players) {
				message.channel.send(strings.could_not_get_top_players.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// construct message
			var msg = '';
			for (i = 0; i < top_players.length; i++) {
				msg += `${(i + 1)}. ${top_players[i].discord_username}: ${top_players[i].elo_rating} ELO\n`;
			}
			message.channel.send(`Top players:\n\`\`\`${msg}\`\`\``);
			break;
	}
});

// tag a user by userID
function tag(userID) {
	return `<@${userID}>`;
}

// tag a role by roleID
function tagRole(roleID) {
	return `<@&${roleID}>`;
}

// calculates game result elo
function calculateElo(playerElo, opponentElo, result) {
	return eloRating.calculate(playerElo, opponentElo, result, config.elo_k);
}

// replaces all occurrences of a substring with a substring
String.prototype.replaceAll = function (search, replacement) {
	var target = this;
	return target.split(search).join(replacement);
}
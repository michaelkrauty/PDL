const discord = require('discord.js');
const glicko2lite = require('glicko2-lite');
const glicko2 = require('glicko2');
const eloRating = require('elo-rating');
const log = require('winston');
const schedule = require('node-schedule');
const fs = require('fs');

const auth = require('./auth.json');
const config = require('./config.js').config;
const db = require('./DB.js');
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
	// 	client.channels.get(discord_channels_to_use[e]).send('Started ' + client.user.username + ' v' + package.version);
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
			msg += discord_channels_to_use[i] + ':' + client.channels.get(discord_channels_to_use[i]) + '\n';
		}
		message.channel.send(msg);
		return;
	}
	// is the channel being used by the bot?
	if (!discord_channels_to_use.includes(message.channel.id))
		return;
	switch (cmd) {
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
				if (!mention_id.success || mention_id.id == null) {
					// target is not registered
					message.channel.send(`${tag(message.author.id)} no data to display.`);
					break;
				}
				mention_id = mention_id.id;
				// get mention data
				var mention_data = await db.getUserDataUsingId(mention_id);
				if (!mention_data.success || mention_data.data == null) {
					message.channel.send(`${tag(message.author.id)} no data to display.`);
					break;
				}
				mention_data = mention_data.data;
				// compose and send message containing user data
				var msg = tag(message.author.id) + '\n';
				for (var elem in mention_data) {
					msg += `${elem}: ${mention_data[elem]}\n`;
				}
				message.channel.send(`${tag(message.author.id)}\n\`\`\`javascript\n${msg}\`\`\``);
				break;
			}
			// get user data
			var user_data = await db.getUserData(message.author.id);
			if (!user_data.success || user_data.data == null) {
				message.channel.send(`${tag(message.author.id)} no data to display.`);
				break;
			}
			user_data = user_data.data;
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
			let challengeme = message.guild.roles.find(role => role.name === "challengeme");
			if (challengeme.id == undefined) {
				message.channel.send(`${tag(message.author.id)} could not find role challengeme`);
				break;
			}
			// toggle challengeme role on/off
			if (message.member._roles.includes(challengeme.id)) {
				// toggle off
				message.member.removeRole(challengeme);
				message.channel.send(`${tag(message.author.id)} no longer has role challengeme`);
			} else {
				// toggle on
				message.member.addRole(challengeme);
				message.channel.send(`${tag(message.author.id)} now has role challengeme`);
			}
			break;
		// challenging command, shows users with challengeme rank
		case 'challenging':
			break;
		// questme command, toggles questme rank
		case 'questme':
			// get questme role
			let questme = message.guild.roles.find(role => role.name === "questme");
			if (questme.id == undefined) {
				message.channel.send(`${tag(message.author.id)} could not find role questme`);
				break;
			}
			// toggle questme role on/off
			if (message.member._roles.includes(questme.id)) {
				// toggle off
				message.member.removeRole(questme);
				message.channel.send(`${tag(message.author.id)} no longer has role questme`);
			} else {
				// toggle on
				message.member.addRole(questme);
				message.channel.send(`${tag(message.author.id)} now has role questme`);
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
				message.channel.send(strings.compete_try_again.replace('{user}', tag(message.author.id)));
				break;
			}
			// register user if they're not already in the DB
			var register_user = await db.registerUser(message.author.id, message.author.username);
			if (register_user.success == null || !register_user.success) {
				// error registering
				log.error('Error executing db.registerUser(' + message.author.id + ', ' + message.author.username + ')');
				message.channel.send(strings.generic_error.replace('{user}', tag(message.author.id)));
				break;
			}
			// set the user's competing state to true
			var user_competing = await db.setUserCompeting(message.author.id, true);
			if (user_competing.success)
				message.channel.send(strings.user_now_competing.replace('{user}', tag(message.author.id)));
			break;
		// quit command, disables competing for the user
		case 'retire':
		case 'quit':
			// check if user is registered
			var user_exists = await db.checkUserExists(message.author.id);
			if (!user_exists.success || !user_exists.exists) {
				// not registered
				message.channel.send(strings.error_not_registered.replace('{user}', tag(message.author.id)));
				break;
			}
			// set the user's competing state to false
			var user_competing = await db.setUserCompeting(message.author.id, false);
			if (user_competing.success) {
				// retired
				message.channel.send(strings.user_no_longer_competing.replace('{user}', tag(message.author.id)));
			}
			break;
		// competing command, shows if user is competing or not
		case 'competing':
			// check if user is registered
			var user_exists = await db.checkUserExists(message.author.id);
			if (!user_exists.success || !user_exists.exists) {
				// not registered
				message.channel.send(strings.error_not_registered.replace('{user}', tag(message.author.id)));
				break;
			}
			// check if user is currently competing
			var user_competing = await db.isUserCompeting(message.author.id);
			((user_competing.success && user_competing.competing) ?
				(message.channel.send(strings.user_is_competing.replace('{user}', tag(message.author.id)))) :
				(message.channel.send(strings.user_is_not_competing.replace('{user}', tag(message.author.id)))));
			break;
		// check command, shows if user is registered in the database
		case 'check':
			if (args.length == 0) {
				// check if user is registered
				var user_exists = await db.checkUserExists(message.author.id);
				(user_exists.success && user_exists.exists ?
					message.channel.send(strings.user_is_registered.replace('{user}', tag(message.author.id))) :
					message.channel.send(strings.user_is_not_registered.replace('{user}', tag(message.author.id))));
			} else if (args.length == 1) {
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions
					message.channel.send(strings.submit_no_user_specified.replace('{user}', tag(message.author.id)));
					break;
				}
				// check if target is registered
				var user_exists = await db.checkUserExists(mention.id);
				if (!user_exists.success || !user_exists.exists) {
					// target is not registered
					message.channel.send(strings.error_target_not_registered.replace('{user}', tag(message.author.id)).replace('{target}', mention.username));
					break;
				}
				// target is registered
				message.channel.send(strings.target_is_registered.replace('{user}', tag(message.author.id)).replace('{target}', mention.username));
			}
			break;
		// oldsr command, shows rank and skill rating (deprecated)
		case 'oldsr':
			if (args.length == 0) {
				// gets user skill rating
				// get user id from discord id
				var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
				if (!user_id_from_discord_id.success || user_id_from_discord_id.id == null) {
					// user is not registered
					message.channel.send(strings.error_not_registered.replace('{user}', tag(message.author.id)));
					break;
				}
				// get user skill rating
				var user_elo_rating = await db.getUserEloRating(user_id_from_discord_id.id);
				if (!user_elo_rating.success) {
					message.channel.send('error');
					break;
				}
				// get user elo rank
				var user_rank = await db.getUserEloRanking(user_id_from_discord_id.id);
				if (!user_rank.success || user_rank.rank == null) {
					message.channel.send('error');
					break;
				}
				// output user skill rating
				message.channel.send(strings.user_skill_rating.replace('{user}', tag(message.author.id)).replace('{skill_rating}', user_elo_rating.elo_rating).replace('{user_rank}', user_rank.rank));
			} else if (args.length == 1) {
				// gets other user's skill rating
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions
					message.channel.send(strings.submit_no_user_specified.replace('{user}', tag(message.author.id)));
					break;
				}
				// get target user id
				var target_id_from_discord_id = await db.getUserIdFromDiscordId(mention.id);
				if (!target_id_from_discord_id.success || target_id_from_discord_id.id == null) {
					// target is not registered
					message.channel.send(strings.error_target_not_registered.replace('{user}', tag(message.author.id)).replace('{target}', mention.username));
					break;
				}
				// get target skill rating
				var target_elo_rating = await db.getUserEloRating(target_id_from_discord_id.id);
				if (!target_elo_rating.success || target_elo_rating.elo_rating == null) {
					// failed to get user elo rating
					log.error('Could not getUserEloRating(' + target_id_from_discord_id.id + ')');
					message.channel.send(strings.generic_error.replace('{user}', tag(message.author.id)));
					break;
				}
				// output target skill rating
				message.channel.send(strings.target_skill_rating.replace('{user}', tag(message.author.id)).replace('{target}', mention.username).replace('{elo}', target_elo_rating.elo_rating));
			}
			break;
		// elo command, shows user rank and elo, plus 2 users above rank and 2 users below rank
		case 'elo':
		case 'rating':
		case 'rank':
		case 'skill':
		case 'sr':
		case 'sr2':
			// get user id from discord id
			var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
			if (!user_id_from_discord_id.success || user_id_from_discord_id.id == null) {
				// user is not registered
				message.channel.send(strings.error_not_registered.replace('{user}', tag(message.author.id)));
				break;
			}
			// get player and nearby players
			var nearby_players = await db.getNearbyPlayers(user_id_from_discord_id.id, 2);
			if (!nearby_players.players || nearby_players.players == null) {
				// failed to get similarly ranked players
				message.channel.send(strings.generic_error.replace('{user}', tag(message.author.id)));
				error.log('could not getNearbyPlayers(' + user_id_from_discord_id.id + ')');
				break;
			}
			// find the user in the list
			nearby_players.players.sort(function (a, b) {
				return !(a.elo_rating > b.elo_rating);
			});
			var player_index = 0;
			for (i = 0; i < nearby_players.players.length; i++) {
				if (nearby_players.players[i].id == user_id_from_discord_id.id)
					player_index = i;
			}
			// construct message
			var msg = '';
			for (i = 0; i < nearby_players.players.length; i++) {
				// do nothing if not within 2 above and 2 below the player
				if (i < player_index - 2 || i > player_index + 2)
					continue;
				// get user elo rank
				var rank = await db.getUserEloRanking(nearby_players.players[i].id);
				if (!rank.success || rank.rank == null) {
					// failed to get similarly ranked players
					message.channel.send(strings.generic_error.replace('{user}', tag(message.author.id)));
					log.error('Could not getUserEloRanking(' + nearby_players.players[i].id + ')');
					break;
				}
				// list top players
				var username = nearby_players.players[i].discord_username;
				if (nearby_players.players[i].id == user_id_from_discord_id.id)
					username = '**' + username + '**'
				msg += rank.rank + '. ' + username + ': ' + nearby_players.players[i].elo_rating + ' ELO\n';

			}
			message.channel.send('' + msg + '');
			break;
		// pending command, shows pending match submissions
		case 'confirmations':
		case 'pending':
			if (args.length == 0) {
				// show pending match submissions vs the user
				// get user id from discord id, checking if the user is registered
				var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
				if (!user_id_from_discord_id.success || user_id_from_discord_id.id == null) {
					// could not get user id from discord id
					message.channel.send(strings.error_not_registered.replace('{user}', tag(message.author.id)));
					break;
				}
				// get user's recent matches
				var user_latest_matches = await db.getUserLatestMatches(user_id_from_discord_id.id);
				if (!user_latest_matches.success || user_latest_matches.matches == null || user_latest_matches.matches.length == 0) {
					// no recent unconfirmed matches
					message.channel.send(strings.no_unconfirmed_matches.replace('{user}', tag(message.author.id)).replace('{target}', message.author.username));
					break;
				}
				// compose response message
				var text = '';
				// loop through retrieved matches
				var waiting_for_input = false;
				var collected = [];
				for (var m in user_latest_matches.matches) {
					var match = user_latest_matches.matches[m];
					// was the submitter the user?
					var submitter_was_user;
					match.player_id == user_id_from_discord_id.id ? submitter_was_user = true : submitter_was_user = false;
					// get the other player's user id
					var opponent_id;
					(submitter_was_user ? opponent_id = match.opponent_id : opponent_id = match.player_id);
					// create a string of the match result (win/loss)
					var match_result_string;
					(match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss');
					// get the other player's discord id using their user id
					// TODO: combine with db.getUserData()
					var opponent_discord_id = await db.getDiscordIdFromUserId(opponent_id);
					if (!opponent_discord_id.success || opponent_discord_id.discord_id == null) {
						// could not get the other player's discord id from their user id
						log.error('Could not getDiscordIdFromUserId(' + opponent_id + ')');
						message.channel.send(strings.generic_error.replace('{user}', tag(message.author.id)));
						break;
					}
					// get opponent user data
					var opponent_data = await db.getUserData(opponent_discord_id.discord_id);
					if (!opponent_data.success || opponent_data.data == null) {
						// could not get the other player's data from their user id
						log.error('Could not getUserData(' + opponent_discord_id.discord_id + ')');
						message.channel.send(strings.generic_error.replace('{user}', tag(message.author.id)));
						break;
					}
					// compose message with match id, tag the author, show other player's name in plaintext (no tag)
					text = '';
					(submitter_was_user ?
						text += tag(message.author.id) + ' submitted a **' + match_result_string + '** vs **' + opponent_data.data.discord_username + '** in Game ' + match.id + '\n' :
						text += '**' + opponent_data.data.discord_username + '** submitted a **' + match_result_string + '** vs ' + tag(message.author.id) + ' in Game ' + match.id + '\n');
					// send it
					var msg = await message.channel.send(text);
					// if the submitter was the user, no emojis necessary.
					if (submitter_was_user)
						continue;
					// ask the user if they won
					waiting_for_input = true;
					await db.putPendingMatch(msg.id, match.id, user_id_from_discord_id.id);
					// add submission reactions to msg
					await msg.react(ReactionEmoji.WIN);
					await msg.react(ReactionEmoji.LOSS);
					// await y/n reaction from user for 60 seconds
					var filter = (reaction, user) => (reaction.emoji.name === ReactionEmoji.WIN || reaction.emoji.name === ReactionEmoji.LOSS) && user.id === message.author.id;
					var collector = msg.createReactionCollector(filter, { time: 60000 });
					// collect reactions
					collector.on('collect', r => {
						async function collect() {
							if (collected.includes(r.message.id))
								return;
							// user reacted y/n
							collected.push(r.message.id);
							var confirm;
							if (r._emoji.name === ReactionEmoji.WIN) {
								await r.message.react(ReactionEmoji.WIN_CONFIRM);
								confirm = MatchResult.WIN;
							} else {
								await r.message.react(ReactionEmoji.LOSS_CONFIRM);
								confirm = MatchResult.LOSS;
							}
							// get match id
							var match_id = await db.getPendingMatch(r.message.id);
							if (!match_id.success || match_id.match_id == null)
								return;
							// get match
							var match = await db.getMatch(match_id.match_id);
							var opponent_discord_id = await db.getDiscordIdFromUserId(match.match.player_id);
							var opponent_data = await db.getUserData(opponent_discord_id.discord_id);
							if (!confirm) {
								// the match was disputed
								await r.message.react(ReactionEmoji.LOSS);
								let admin_tag = message.guild.roles.find(role => role.name === "admin");
								await message.channel.send(tag(message.author.id) + ' disputes match ' + match_id.match_id + ' vs ' + tag(opponent_data.data.discord_id) + ' ' + tagRole(admin_tag.id));
							} else {
								// the match was confirmed
								await r.message.react(ReactionEmoji.WIN);
								if (config.rating_method == RatingMethod.ELO) {
									// get user's elo rating
									var userElo = await db.getUserEloRating(match.match.player_id);
									var uELO = userElo.elo_rating;
									// get opponent's elo rating
									var opponentElo = await db.getUserEloRating(match.match.opponent_id);
									var tELO = opponentElo.elo_rating;
									// calculate new elo
									var eloRatingCalculation = calculateElo(uELO, tELO, match.match.result);
									var newUserELO = eloRatingCalculation.playerRating + config.bonus_elo;
									var newTargetELO = eloRatingCalculation.opponentRating + config.bonus_elo;
									// set user's new elo rating
									db.setUserEloRating(match.match.player_id, newUserELO);
									// set target's new elo rating
									db.setUserEloRating(match.match.opponent_id, newTargetELO);
									// set confirm the match
									db.setMatchResultConfirmed(match.match.id, true);
									// get users' new ranks
									var user_rank = await db.getUserEloRanking(match.match.player_id);
									var target_rank = await db.getUserEloRanking(match.match.opponent_id);
									// message users
									var winloss;
									match.match.result ? winloss = 'win' : winloss = 'loss';
									await message.channel.send(strings.new_elo_message
										.replace('{game_id}', match.match.id)
										.replace('{winloss}', winloss)
										.replace('{user}', tag(opponent_data.data.discord_id))
										.replace('{target}', tag(message.author.id))
										.replace('{user_name}', opponent_data.data.discord_username)
										.replace('{target_name}', message.author.username)
										.replace('{user_elo_rank}', user_rank.rank)
										.replace('{target_elo_rank}', target_rank.rank)
										.replace('{old_user_elo}', uELO)
										.replace('{new_user_elo}', newUserELO)
										.replace('{old_target_elo}', tELO)
										.replace('{new_target_elo}', newTargetELO));
								}
							}
							await db.removePendingMatch(r.message.id, match.match.id);
							await r.message.react(ReactionEmoji.CONFIRMED);
						}
						collect().catch((err) => {
							// error collecting reactions
							log.error(err);
						});
					});
					collector.on('end', collected => {
						if (collected.size < 1) {
							// console.log(collector.message);
							// var match_id = await db.getPendingMatch(collector.message.id);
							// no y/n reaction was collected
							message.channel.send(strings.pending_submit_timeout.replace('{user}', tag(message.author.id)));
							async function removePendingMatch() {
								await db.removePendingMatch(match.id, msg.id, user_id_from_discord_id.id);
							}
							removePendingMatch().catch((err) => {
								log.error(err);
							});
						}
					});

				}
				// a match has confirm and dispute options
				if (waiting_for_input) {
					message.channel.send(tag(message.author.id) + ' Use the check to confirm, or X to dispute.');
				}
			} else if (args.length == 1 && admin) {
				// admins can confirm or reject other users' pending games
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions, too many arguments
					message.channel.send(strings.pending_no_user_specified.replace('{user}', tag(message.author.id)));
					break;
				}
				// get target user id from target discord id, checking if the target is registered
				var target_id_from_discord_id = await db.getUserIdFromDiscordId(mention.id);
				if (!target_id_from_discord_id.success || target_id_from_discord_id.id == null) {
					// could not get target user id from discord id
					message.channel.send(strings.error_target_not_registered.replace('{user}', tag(message.author.id).replace('{target}', mention.username)));
					break;
				}
				// get user id from discord id, checking if the user is registered
				var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
				if (!user_id_from_discord_id.success || user_id_from_discord_id.id == null) {
					// could not get user id from discord id
					message.channel.send(strings.error_not_registered.replace('{user}', tag(message.author.id)));
					break;
				}
				// get target's recent matches
				var target_latest_matches = await db.getUserLatestMatches(target_id_from_discord_id.id);
				if (!target_latest_matches.success || target_latest_matches.matches == null || target_latest_matches.matches.length == 0) {
					// no recent unconfirmed matches
					message.channel.send(strings.no_unconfirmed_matches.replace('{user}', tag(message.author.id)).replace('{target}', mention.username));
					break;
				}
				// compose response message
				var msg = tag(message.author.id) + '\n';
				// loop through the target's latest matches
				for (var m in target_latest_matches.matches) {
					var match = target_latest_matches.matches[m];
					// get the other player's user id
					var opponent_id;
					var match_submitted_by_target = match.player_id == target_id_from_discord_id.id;
					match_submitted_by_target ?
						opponent_id = match.opponent_id :
						opponent_id = match.player_id;
					// match result ? 'win' : 'loss'
					var match_result_string;
					(match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss');
					// get the other player's discord id using their user id
					var opponent_discord_id = await db.getDiscordIdFromUserId(opponent_id);
					if (!opponent_discord_id.success || opponent_discord_id.discord_id == null) {
						// could not get the other player's discord id from their user id
						log.error('Could not getDiscordIdFromUserId(' + opponent_id + ')');
						message.channel.send(strings.generic_error.replace('{user}', tag(message.author.id)));
						break;
					}
					// get the opponent's user data
					// TODO: getUserData with user id or discord id
					var opponent_data = await db.getUserData(opponent_discord_id.discord_id);
					if (!opponent_data.success || opponent_data.data == null) {
						// could not get the other player's data from their user id
						log.error('Could not getUserData(' + opponent_discord_id.discord_id + ')');
						message.channel.send(strings.generic_error.replace('{user}', tag(message.author.id)));
						break;
					}
					// tag the opponent if it's the author, else don't tag them
					var opponent_username;
					(opponent_data.data.discord_id == message.author.id ?
						opponent_username = tag(message.author.id) :
						opponent_username = opponent_data.data.discord_username);
					// construct message
					msg += 'Game ' + match.id + ': ';
					match_submitted_by_target ? msg += mention.username : msg += opponent_username;
					msg += ' submitted a ' + match_result_string + ' vs ';
					match_submitted_by_target ? msg += opponent_username : msg += mention.username;
					msg += '\n';
				}
				message.channel.send(msg);
			}
			break;
		// submit command, submits a match result vs another user
		case 'submit':
			// get user id from discord id, checking if the user is registered
			var user_id_from_discord_id = await db.getUserIdFromDiscordId(message.author.id);
			if (!user_id_from_discord_id.success || user_id_from_discord_id.id == null) {
				// could not get user id from discord id
				message.channel.send(strings.error_not_registered.replace('{user}', tag(message.author.id)));
				break;
			}
			// check if user is competing
			var user_is_competing = await db.isUserCompeting(message.author.id);
			if (!user_is_competing.success || user_is_competing.competing == null || !user_is_competing.competing) {
				// user is not competing
				message.channel.send(strings.error_user_not_competing.replace('{user}', tag(message.author.id)));
				break;
			}
			// check for a mention
			var mention = message.mentions.users.values().next().value;
			if (args.length != 1 || mention == undefined || mention.id == message.author.id) {
				// no mentions, too many arguments, or user mentioned self
				message.channel.send(strings.submit_no_user_specified.replace('{user}', tag(message.author.id)));
				break;
			}
			// check if target is registered
			var target_id_from_discord_id = await db.getUserIdFromDiscordId(mention.id);
			if (!target_id_from_discord_id.success || target_id_from_discord_id.id == null) {
				// could not get target id from discord id
				message.channel.send(strings.error_target_not_registered.replace('{user}', tag(message.author.id)).replace('{target}', mention.username));
				break;
			}
			// check if target is competing
			var is_target_competing = await db.isUserCompeting(mention.id);
			if (!is_target_competing.success || is_target_competing.competing == null || !is_target_competing.competing) {
				// target is not competing
				message.channel.send(strings.target_is_not_competing.replace('{user}', tag(message.author.id)).replace('{target}', mention.username));
				break;
			}
			// get the user's latest matches
			var user_latest_matches = await db.getUserLatestMatches(user_id_from_discord_id.id);
			if (!user_latest_matches.success) {
				// success = false
				message.channel.send('error');
				break;
			}
			// get the target's latest matches
			var target_latest_matches = await db.getUserLatestMatches(target_id_from_discord_id.id);
			if (!target_latest_matches.success) {
				// target has no recent matches
				message.channel.send('target no recent matches');
				break;
			}
			// get the amount of matches the user has played within the last week
			// TODO
			// if the user has less match submissions than the weekly limit as set in the config
			// if (user_latest_matches['matches'].length + target_latest_matches['matches'].length >= config.maximum_weekly_challenges) {
			// 	// user has already played the maximum amount of matches for the week
			// 	message.channel.send('maximum weekly matches: ' + config.maximum_weekly_challenges);
			// 	break;
			// }
			// ask the user if they won
			var msg = await message.channel.send(strings.did_you_win.replace('{user}', tag(message.author.id)).replace('{target}', mention.username));
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
					await msg.react(r._emoji.name);
					// did the user win the match?
					var result;
					((r._emoji.name === ReactionEmoji.WIN) ? result = MatchResult.WIN : result = MatchResult.LOSS);
					// submit match result
					await db.submitMatchResult(user_id_from_discord_id.id, target_id_from_discord_id.id, result);
					// ask the target user to confirm the game
					message.channel.send(strings.confirm_game_please.replace('{target}', tag(mention.id)).replace('{user}', message.author.username).replace('{game_id}'));
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
					message.channel.send(strings.match_submit_timeout.replace('{user}', tag(message.author.id)));
				}
			});
			break;
		// matchinfo command, allows admins to see match information with match id
		case 'matchinfo':
			if (args.length != 1 || !admin)
				break;
			var match = await db.getMatch(args[0]);
			if (!match.success || match.match == null)
				break;
			var msg = '';
			for (var e in match.match) {
				msg += e + ': ' + match.match[e] + '\n';
			}
			message.channel.send('```' + msg + '```');
			break;
		// top command, shows top 25 competing players by elo
		case 'top':
			if (args.length != 0)
				break;
			// get top players
			var top_players = await db.getTopCompetingPlayers(25);
			if (!top_players.success || top_players.players == null) {
				message.channel.send(strings.could_not_get_top_players.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// construct message
			var msg = '';
			for (i = 0; i < top_players.players.length; i++) {
				msg += `${(i + 1)}. ${top_players.players[i].discord_username}: ${top_players.players[i].elo_rating} ELO\n`;
			}
			message.channel.send(`Top players:\n\`\`\`${msg}\`\`\``);
			break;
	}
});

// tag a user by userID
function tag(userID) {
	return `<@${userID}>`;
}

// tag a role by userID
function tagRole(userID) {
	return `<@${userID}>`;
}

function calculateElo(playerElo, opponentElo, result) {
	return eloRating.calculate(playerElo, opponentElo, result, config.elo_k);
}

String.prototype.replaceAll = function (search, replacement) {
	var target = this;
	return target.split(search).join(replacement);
};

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
	console.log(`scorched rating: ${scorched.getRating()}`);
	console.log(`scorched deviation: ${scorched.getRd()}`);
	console.log(`scorched volatility: ${scorched.getVol()}`);
}
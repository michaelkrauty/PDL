// dependencies
const discord = require('discord.js');
const schedule = require('node-schedule');
const eloRating = require('elo-rating');
const log = require('winston');
// local requires
const config = require('./config.js').config;
const config_db = require('./config_db.js');
const db = require('./database.js');
const User = require('./User.js').User;
const strings = require('./strings.js');
const fm = require('./filemanager.js');
const package = require('./package.json');

// enums
const MatchResult = { WIN: 1, LOSS: 0 };
const RatingMethod = { ELO: 0, GLICKO2_LIVE: 1, GLICKO2_SCHEDULE: 2 };
const ReactionEmoji = { WIN: '👍', LOSS: '👎', CONFIRMED: '👌', WIN_CONFIRM: '✅', LOSS_CONFIRM: '❌', CANCEL: '🇽' };
exports = MatchResult, RatingMethod;

// runtime variables
var discord_channels_to_use;
var admin_discord_ids;
var started = false;

// configure logger settings
log.remove(log.transports.Console);
log.add(new log.transports.Console, { colorize: true });
log.level = 'debug';

// initialize Discord bot
const client = new discord.Client();
client.login(config_db.bot_token).catch((err) => {
	log.error('Could not connect to discord servers:');
	log.error(err.message);
	client.destroy();
});
client.once('ready', async () => {
	log.info(`Starting ${client.user.username} v${package.version} - (${client.user.id})`);
	// add bot version to bot name, if enabled
	if (config.enable_version_in_bot_name) {
		let cName = client.user.username;
		let nName = cName;
		// locate the version number in the bot username
		let ver_loc = cName.search(/[ v][0-9].[0-9].[0-9]/);
		let ver = cName.substring(ver_loc).trim();
		// check if bot username version number matches actual bot version
		if (ver != package.version) {
			if (ver != cName)
				nName = `${cName.substr(0, ver_loc)}v${package.version}`;
			else
				nName = `${cName} v${package.version}`;
			// update bot username
			if (nName.length >= 2 && nName.length <= 32)
				client.user.setUsername(nName).then(null, (err) => {
					log.error(`Error updating bot discord username: ${err.message}`);
				});
		}
	}
	// setup json storage files
	await fm.checkFile('./channels.json');
	discord_channels_to_use = await require('./channels.json').data;
	await fm.checkFile('./admins.json');
	admin_discord_ids = await require('./admins.json').data;
	// connect to database
	await db.connect();
	// setup weekly elo decay job, if enabled
	if (config.weekly_elo_decay) {
		var j = schedule.scheduleJob('DecayElo', '59 0 0 * * 1', async () => {
			console.log('ELO Decayed');
			// decay inactive users and get a list of users whose elo has been decayed
			var decayed = await decayInactiveElo(config.weekly_elo_decay_amount);
			if (decayed.length > 0) {
				// construct player list for message
				var decayedStr = '';
				log.info(`Decayed the following players ELO by ${config.weekly_elo_decay_amount}:`);
				for (var p in decayed) {
					decayedStr += `\`${decayed[p].discord_username}: ${decayed[p].old_elo}->${decayed[p].new_elo}\`\n`;
					log.info(`${decayed[p].id}:${decayed[p].discord_username}: ${decayed[p].old_elo}->${decayed[p].new_elo}`);
				}
				// send message to active channels
				for (var c in discord_channels_to_use)
					client.channels.get(discord_channels_to_use[c]).send(strings.weekly_elo_decay.replaceAll('{matchlimit}', config.maximum_weekly_challenges).replaceAll('{players}', decayedStr));
			}
		});
	}
	// startup complete
	started = true;
	log.info(`${client.user.username} startup complete!`);
});

// store discord ids running commands
var user_commands_running = new Map();
// store reaction collectors in an array
var collectors = [];

// called when the bot sees a message
client.on('message', async (message) => {
	// check if the bot is ready to handle commands
	if (!started)
		return;
	// commands start with !
	if (message.content.substring(0, 1) != '!')
		return;
	// check if user is in the map of users running commands
	let pendingUserResponsesContainsUser = false;
	user_commands_running.forEach(value => {
		if (value === message.author.id)
			pendingUserResponsesContainsUser = true;
	});
	// users can only run one command at a time
	if (pendingUserResponsesContainsUser) {
		message.channel.send(`${tag(message.author.id)} only one command can be run at a time.`);
		return;
	}
	// ensure only one instance of the command by storing the command message id and author id in map
	user_commands_running.set(message.id, message.author.id);
	// user class variable
	var user;
	// get user ID from database if it exists
	var user_id = await db.getUserIdFromDiscordId(message.author.id);
	// create user class if user exists
	if (user_id)
		user = await new User(user_id, db).init();
	// update discord username in database, if it has changed
	if (user)
		if (user.discord_username != message.author.username)
			await user.setDiscordUsername(message.author.username);
	// create cmd and args variables
	var args = message.content.substring(1).split(' ');
	const cmd = args[0];
	args = args.splice(1);
	// check if user is admin
	var admin = admin_discord_ids.includes(message.author.id);
	// is the channel being used by the bot?
	if (!discord_channels_to_use.includes(message.channel.id) && cmd != 'admin') {
		// remove command message from pending user responses
		user_commands_running.delete(message.id);
		return;
	}
	switch (cmd) {
		// version command, shows current bot version
		case 'version':
			message.channel.send(`v${package.version}`);
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// TODO: remove this command before release, for debug only
		// say command, makes the bot say a message
		case 'say':
			// construct and send message
			var msg = '';
			for (i = 0; i < args.length; i++)
				(i - 1 < args.length) ? msg += `${args[i]} ` : msg += args[i];
			message.channel.send(msg);
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
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
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// check if target exists
				var target = await new User(mention_id, db).init();
				if (!target) {
					message.channel.send(`${tag(message.author.id)} no data to display.`);
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// compose and send message containing user data
				var msg = '';
				for (var elem in target)
					msg += `${elem}: ${target[elem]}\n`;
				message.channel.send(`${tag(message.author.id)}\n\`\`\`javascript\n${msg}\`\`\``);
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// check if user is registered
			if (!user) {
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// compose and send message containing user data
			var msg = '';
			for (var elem in user)
				msg += `${elem}: ${user[elem]}\n`;
			message.channel.send(`${tag(message.author.id)}\n\`\`\`javascript\n${msg}\`\`\``);
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// help command, shows help dialogue
		case 'help':
			msg = strings.help;
			if (admin) msg += `\n${strings.admin_help}`;
			message.channel.send(msg.replaceAll('{user}', tag(message.author.id)));
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// challengeme command, toggles challengeme rank
		case 'challengeme':
			// get challengeme role
			let challengeme = await message.guild.roles.find(role => role.name === "challengeme");
			if (challengeme.id == undefined) {
				message.channel.send(`${tag(message.author.id)} could not find role challengeme.`);
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// ensure the user is registered
			if (!user) {
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
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
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// challenging command, shows users with challengeme rank
		// TODO
		case 'challenging':
			break;
		// questme command, toggles questme rank
		case 'questme':
			// get questme role
			let questme = await message.guild.roles.find(role => role.name === "questme");
			if (questme.id == undefined) {
				message.channel.send(`${tag(message.author.id)} could not find role questme.`);
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// ensure the user is registered
			if (!user) {
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
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
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// questing command, shows users with questme rank
		// TODO
		case 'questing':
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// compete command, registers the user in the database and/or enables competing for the user
		case 'register':
		case 'compete':
			// require no arguments
			if (args.length != 0) {
				message.channel.send(strings.compete_try_again.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// register user if they're not already in the DB
			if (!user) {
				await db.registerUser(message.author.id, message.author.username);
				// get user's new user ID
				user_id = await db.getUserIdFromDiscordId(message.author.id);
				// create new User class
				user = await new User(user_id, db).init();
			} else {
				// check if the user is currently competing
				if (user.competing) {
					message.channel.send(strings.compete_already_competing.replaceAll('{user}', tag(message.author.id)));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
			}
			// set the user's competing state to true
			var res = await user.setCompeting(true);
			if (res)
				message.channel.send(strings.user_now_competing.replaceAll('{user}', tag(message.author.id)));
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// quit command, disables competing for the user
		case 'retire':
		case 'quit':
			// check if user is registered
			if (!user) {
				// not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// check if the user is currently competing
			if (!user.competing) {
				message.channel.send(strings.quit_not_competing.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// set the user's competing state to false
			var res = await user.setCompeting(false);
			if (res)
				message.channel.send(strings.user_no_longer_competing.replaceAll('{user}', tag(message.author.id)));
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// competing command, shows if user is competing or not
		case 'competing':
			// check if user is registered
			if (!user) {
				// not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// check if user is currently competing
			user.competing ?
				message.channel.send(strings.user_is_competing.replaceAll('{user}', tag(message.author.id))) :
				message.channel.send(strings.user_is_not_competing.replaceAll('{user}', tag(message.author.id)));
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// check command, shows if user is registered in the database
		case 'registered':
			if (args.length == 0) {
				// check if user is registered
				user ?
					message.channel.send(strings.user_is_registered.replaceAll('{user}', tag(message.author.id))) :
					message.channel.send(strings.user_is_not_registered.replaceAll('{user}', tag(message.author.id)));
			} else if (args.length == 1) {
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions
					message.channel.send(strings.submit_no_user_specified.replaceAll('{user}', tag(message.author.id)));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// check if target is registered
				var mention_exists = await db.checkUserExists(mention.id);
				if (!mention_exists) {
					// target is not registered
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// target is registered
				message.channel.send(strings.target_is_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
			}
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// oldsr command, shows rank and skill rating (deprecated)
		case 'oldsr':
			if (args.length == 0) {
				// gets user skill rating
				// check if user is registered
				if (!user) {
					// user is not registered
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// output user skill rating
				message.channel.send(strings.user_skill_rating.replaceAll('{user}', tag(message.author.id)).replaceAll('{elo_rating}', user.elo_rating).replaceAll('{elo_rank}', user.elo_rating));
			} else if (args.length == 1) {
				// gets other user's skill rating
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions
					message.channel.send(strings.submit_no_user_specified.replaceAll('{user}', tag(message.author.id)));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// get target user id
				var target_id = await db.getUserIdFromDiscordId(mention.id);
				if (!target_id) {
					// target is not registered
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// get target
				var target = await new User(target_id, db).init();
				if (!target) {
					// failed to get target user
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// output target skill rating
				message.channel.send(strings.target_skill_rating.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username).replaceAll('{elo_rating}', target.elo_rating).replaceAll('{elo_rank}', target.elo_rank));
			}
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// elo command, shows user rank and elo, plus 2 users above rank and 2 users below rank
		case 'elo':
		case 'rating':
		case 'rank':
		case 'skill':
		case 'sr':
		case 'sr2':
			// TODO: add !sr <player>
			// check if user is registered
			if (!user) {
				// user is not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// check if user is competing
			if (!user.competing) {
				// user is not competing
				message.channel.send(strings.error_user_not_competing.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// check if user has played enough provisional matches to show elo
			var numMatches = await db.getUserNumConfirmedMatches(user.id);
			if (!numMatches || numMatches.length < config.provisional_matches) {
				if (!numMatches)
					numMatches = [];
				message.channel.send(strings.not_enough_provisional_matches_played.replaceAll('{user}', tag(message.author.id)).replaceAll('{num_games_played}', numMatches.length).replaceAll('{provisional_matches}', config.provisional_matches));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// get player and nearby players
			var nearby_players = await db.getNearbyPlayers(user.id, 2);
			if (!nearby_players || nearby_players.length < 1) {
				// failed to get similarly ranked players
				message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
				throw (`Could not getNearbyPlayers(${user.id}, 2)`);
			}
			// sort the players by elo
			nearby_players.sort(function (a, b) {
				return !(a.elo_rating > b.elo_rating);
			});
			// find the user in the player list
			var player_index = 0;
			for (i = 0; i < nearby_players.length; i++)
				if (nearby_players[i].id == user.id)
					player_index = i;
			// construct message
			var msg = '';
			for (i = 0; i < nearby_players.length; i++) {
				// do nothing if not within 2 above and 2 below the player
				if (i < player_index - 2 || i > player_index + 2)
					continue;
				// get user elo rank
				var rank = await db.getUserEloRanking(nearby_players[i].id);
				if (!rank) {
					// failed to get player's elo ranking
					message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
					throw (`Could not getUserEloRanking(${nearby_players[i].id})`);
				}
				// list top players
				var username = nearby_players[i].discord_username;
				if (nearby_players[i].id == user.id)
					username = `**${username}**`;
				msg += `${rank}. ${username}: ${nearby_players[i].elo_rating} ELO\n`;

			}
			message.channel.send(msg);
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// confirm command, shows pending match submissions
		case 'confirm':
		case 'confirmations':
			if (args.length == 0) {
				// show pending match submissions vs the user
				// check if user is registered
				if (!user) {
					// not registered
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// get user's recent matches
				var latest_matches = await db.getUserUnconfirmedMatches(user.id);
				if (!latest_matches) {
					// no recent unconfirmed matches
					message.channel.send(strings.no_unconfirmed_matches.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', message.author.username));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// waiting_for_input will be true if there is one or more match which the user should confirm with reaction emojis
				var waiting_for_input = false;
				// ensure only one response from the user per message by storing message ids in collected array
				var collected = [];
				// ties message id to match id
				// key: message id, value: match id
				var user_pending_matches = new Map();
				// loop through retrieved matches
				for (var m in latest_matches) {
					var match = latest_matches[m];
					// was the submitter the user?
					var submitter_was_user = match.player_id == user.id;
					// get the other player's user id
					var opponent_id;
					submitter_was_user ? opponent_id = match.opponent_id : opponent_id = match.player_id;
					// create a string of the match result (win/loss)
					var match_result_string;
					match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss';
					// get opponent user data
					var opponent_data = await db.getUserDataUsingId(opponent_id);
					if (!opponent_data) {
						// could not get the other player's data from their user id
						message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
						throw (`Could not getUserDataUsingId(${opponent_id})`);
					}
					// compose message with match id, tag the author, show other player's name in plaintext (no tag)
					var text = '';
					submitter_was_user ? text += strings.pending_submitter_was_user : text += strings.pending_submitter_was_not_user;
					// send it
					var msg = await message.channel.send(text
						.replaceAll('{user}', tag(message.author.id))
						.replaceAll('{opponent_name}', opponent_data.discord_username)
						.replaceAll('{match_id}', match.id)
						.replaceAll('{winloss}', match_result_string)
					);
					// if the submitter was the user, no emojis necessary.
					if (submitter_was_user)
						continue;
					// ask the user to thumb up/down whether they won or not after looping through all unconfirmed matches
					waiting_for_input = true;
					// tie the message id to the match id
					user_pending_matches.set(msg.id, match.id);
					// ensure one instance of the command
					user_commands_running.set(msg.id, message.author.id);
					// await y/n/cancel reaction from user for 60 seconds
					var filter = (reaction, usr) => (reaction.emoji.name === ReactionEmoji.WIN || reaction.emoji.name === ReactionEmoji.LOSS || reaction.emoji.name === ReactionEmoji.CANCEL) && usr.id === message.author.id;
					var collector = msg.createReactionCollector(filter, { time: 60000 });
					collector.on('collect', async (r) => {
						// already got a response from the user for this message
						if (collected.includes(r.message.id))
							return;
						// return if the message id isn't tied to a match id, for whatever reason
						if (!user_pending_matches.has(r.message.id))
							return;
						// get match id from map using message id for key
						var match_id = user_pending_matches.get(r.message.id);
						// put the message id in the collected array, to prevent the user from reacting to the same message again
						// TODO: I believe collected will continue to grow as players use the confirm command
						collected.push(r.message.id);
						// get match
						var match = await db.getMatch(match_id);
						if (!match)
							throw (`Could not getMatch(${match_id})`);
						// return if the match is already confirmed, for whatever reason
						if (match.confirmed)
							return;
						// confirm or dispute?
						var confirm;
						if (r._emoji.name === ReactionEmoji.WIN) {
							// user confirms the match result
							await r.message.react(ReactionEmoji.WIN_CONFIRM);
							confirm = MatchResult.WIN;
						} else if (r._emoji.name === ReactionEmoji.LOSS) {
							// user disputes the match result
							await r.message.react(ReactionEmoji.LOSS_CONFIRM);
							confirm = MatchResult.LOSS;
						} else if (r._emoji.name === ReactionEmoji.CANCEL) {
							// user cancelled
							user_pending_matches.delete(r.message.id);
							user_commands_running.delete(r.message.id);
							await r.message.react(ReactionEmoji.CONFIRMED);
							return;
						}
						// get opponent data
						var opponent_data = await db.getUserDataUsingId(match.player_id);
						if (!opponent_data)
							throw (`Could not getUserDataUsingId(${match.player_id})`);
						if (!confirm) {
							// the match was disputed
							await r.message.channel.send(strings.pending_dispute
								.replaceAll('{user}', tag(message.author.id))
								.replaceAll('{opponent}', tag(opponent_data.discord_id))
								.replaceAll('{match_id}', match.id)
								// TODO: add admin role name to config
								.replaceAll('{admin}', tagRole(message.guild.roles.find(role => role.name === "admin").id))
							);
							await r.message.react(ReactionEmoji.LOSS);
						} else {
							// the match was confirmed
							if (config.rating_method == RatingMethod.ELO) {
								// get player's elo rating
								var playerElo = await db.getUserEloRating(match.player_id);
								if (!playerElo)
									throw (`Could not getUserEloRating(${match.player_id})`);
								// get opponent's elo rating
								var opponentElo = await db.getUserEloRating(match.opponent_id);
								if (!opponentElo)
									throw (`Could not getUserEloRating(${match.opponent_id})`);
								// calculate new elo
								var eloCalculation = calculateElo(playerElo, opponentElo, null, null, null, null, match.result);
								// new players' elo, plus bonus elo as defined in the config
								var newPlayerElo = eloCalculation.new_player_elo + config.bonus_elo;
								var newOpponentElo = eloCalculation.new_opponent_elo + config.bonus_elo;
								// set players' new elo rating
								await db.setUserEloRating(match.player_id, newPlayerElo);
								await db.setUserEloRating(match.opponent_id, newOpponentElo);
								// update the match info
								// use player elo + net elo instead of new player elo, so if the match is ever cancelled, we can revert elo properly.
								await db.updateMatch(match.id, true, playerElo, playerElo + eloCalculation.net_player_elo, opponentElo, opponentElo + eloCalculation.net_opponent_elo);
								// get player's new rank
								var player_rank = await db.getUserEloRanking(match.player_id);
								if (!player_rank)
									throw (`Could not getUserEloRanking(${match.player_id})`);
								// get opponent's new rank
								var opponent_rank = await db.getUserEloRanking(match.opponent_id);
								if (!opponent_rank)
									throw (`Could not getUserEloRanking(${match.opponent_id})`);
								// get player data
								var player_data = await db.getUserDataUsingId(match.player_id);
								if (!player_data)
									throw (`Could not getUserDataUsingId(${match.player_id})`);
								// get opponent data
								var opponent_data = await db.getUserDataUsingId(match.opponent_id);
								if (!opponent_data)
									throw (`Could not getUserDataUsingId(${match.opponent_id})`);
								// compose message with elo change and tag the players
								var winloss;
								match.result ? winloss = 'win' : winloss = 'loss';
								await message.channel.send(strings.pending_confirm
									.replaceAll('{new_elo_message}', strings.new_elo_message)
									.replaceAll('{match_id}', match.id)
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
									.replaceAll('{new_opponent_elo}', newOpponentElo));
							}
							await r.message.react(ReactionEmoji.WIN);
						}
						// remove message from the map where the value is the message author id
						user_commands_running.delete(r.message.id);
					});
					// add submission reactions to msg
					await msg.react(ReactionEmoji.WIN);
					await msg.react(ReactionEmoji.LOSS);
					await msg.react(ReactionEmoji.CANCEL);
					collector.on('end', collected => {
						// collector ends when the filter time is up
						// loop through all collectors
						for (var c in collectors) {
							// remove the message id from the map which stoes the match id
							user_pending_matches.delete(collectors[c].message.id);
							// if this collector's message id is a key in the map of users running commands, and the value is the author's discord id
							if (user_commands_running.get(collectors[c].message.id) == message.author.id) {
								// remove this collector's message id entry from the map
								user_commands_running.delete(collectors[c].message.id);
								// react to the message to signify that it was cancelled
								collectors[c].message.react(ReactionEmoji.CONFIRMED);
							}
						}
					});
					// add the reaction collector to the a array of collectors
					collectors.push(collector);
				}
				// a match has confirm and dispute emojis waiting for input
				if (waiting_for_input)
					message.channel.send(strings.pending_waiting_for_input.replaceAll('{user}', tag(message.author.id)));
			}
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// submit command, submits a match result vs another user
		case 'submit':
			// ensure the user is registered
			if (!user) {
				// user not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// check for a mention
			var mention = message.mentions.users.values().next().value;
			if (args.length != 1 || mention == undefined || mention.id == message.author.id) {
				// no mentions, too many arguments, or user mentioned self
				message.channel.send(strings.submit_no_user_specified.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// get mention's database id
			var mention_discord_id = await db.getUserIdFromDiscordId(mention.id);
			if (!mention_discord_id) {
				// mention is not registered
				message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// get mention data
			var target = await new User(mention_discord_id, db).init();
			// check if mention is competing
			if (!target.competing) {
				// mention is not competing
				message.channel.send(strings.target_is_not_competing.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// get the user's latest matches of the week
			var user_matches = await db.getUserLatestMatchesOfWeek(user.id);
			// check if user has played the maximum amount of games this week as defined in the config
			if (user_matches)
				if (user_matches.length >= config.maximum_weekly_challenges) {
					// user has already played the maximum amount of matches for the week
					message.channel.send(strings.max_weekly_matches_played.replaceAll('{user}', tag(message.author.id)).replaceAll('{maximum_weekly_challenges}', config.maximum_weekly_challenges));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
			// get the mention's latest matches of the week
			var target_latest_matches = await db.getUserLatestMatchesOfWeek(target.id);
			// check if target has played the maximum amount of games this week as defined in the config
			if (target_latest_matches)
				if (target_latest_matches.length >= config.maximum_weekly_challenges) {
					// mention has already played the maximum amount of matches for the week
					message.channel.send(strings.max_weekly_matches_played_other.replaceAll('{mention_name}', mention.username).replaceAll('{maximum_weekly_challenges}', config.maximum_weekly_challenges));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
			// ask the user if they won
			var msg = await message.channel.send(strings.did_you_win.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			// ensure only one response from the user by storing the message id and author id in map
			user_commands_running.set(msg.id, message.author.id);
			// ensure only one response from the user by storing message id in collected array
			var collected = [];
			// await y/n/cancel reaction from user for 60 seconds
			var filter = (reaction, usr) => (reaction.emoji.name === ReactionEmoji.WIN || reaction.emoji.name === ReactionEmoji.LOSS || reaction.emoji.name === ReactionEmoji.CANCEL) && usr.id === message.author.id;
			var collector = msg.createReactionCollector(filter, { time: 60000 });
			// TODO: apply multiple !confirm fix to !submit
			collector.on('collect', async (r) => {
				// user already reacted to this message
				if (collected.includes(r.message.id))
					return;
				// add the message to the collected array to ensure only one response from the user
				collected.push(r.message.id);
				// user reacted y/n, what was the match result?
				var result;
				if (r._emoji.name === ReactionEmoji.WIN)
					result = MatchResult.WIN;
				else if (r._emoji.name === ReactionEmoji.LOSS)
					result = MatchResult.LOSS;
				else if (r._emoji.name === ReactionEmoji.CANCEL) {
					collector.stop();
					return;
				}
				// get player's elo rating
				var playerElo = user.elo_rating;
				// get opponent's elo rating
				var opponentElo = target.elo_rating;
				// submit match result
				await db.submitMatchResult(user.id, target.id, (result == MatchResult.WIN), playerElo, opponentElo, null, null);
				// ask the target user to confirm the game
				message.channel.send(strings.confirm_game_please.replaceAll('{target}', tag(mention.id)).replaceAll('{user}', message.author.username).replaceAll('{match_id}'));
				collector.stop();
				// remove message from pending user responses
				user_commands_running.delete(msg.id);
				msg.react(ReactionEmoji.CONFIRMED);
			});
			// add submission reactions to msg
			await msg.react(ReactionEmoji.WIN);
			await msg.react(ReactionEmoji.LOSS);
			await msg.react(ReactionEmoji.CANCEL);
			collector.on('end', collected => {
				if (collected.size < 1) {
					// no y/n reaction was collected
					message.channel.send(strings.match_submit_timeout.replaceAll('{user}', tag(message.author.id)));
				} else if (collected.get(ReactionEmoji.CANCEL) != null) {
					// submission cancelled by user
					message.channel.send(strings.match_submit_cancel.replaceAll('{user}', tag(message.author.id)));
					msg.react(ReactionEmoji.CONFIRMED);
				}
				// remove message from pending user responses
				user_commands_running.delete(msg.id);
			});
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// matches command, shows matches from this week and past week
		case 'matches':
			// get other player's matches
			if (args.length == 1) {
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined || mention.id == message.author.id) {
					// no mentions, or user mentioned self
					message.channel.send(strings.matches_no_user_specified.replaceAll('{user}', tag(message.author.id)));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// get target user id from target discord id, checking if the target is registered
				var target_id = await db.getUserIdFromDiscordId(mention.id);
				if (!target_id) {
					// could not get target user id from discord id
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// ensure the user is registered
				if (!user) {
					// not registered
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// get all of the target's matches
				var user_matches = await db.getAllUserMatches(target_id);
				if (!user_matches) {
					// no matches found
					message.channel.send(strings.matches_no_recent_matches.replaceAll('{user}', tag(message.author.id)));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				var confirmed_matches = [];
				var unconfirmed_matches = [];
				// loop through user's matches
				for (var n in user_matches) {
					// sort out matches which are confirmed or did not happen this week
					let thisMonday = getMonday(new Date());
					let matchMonday = getMonday(new Date(user_matches[n].timestamp));
					if (user_matches[n].confirmed && matchMonday.toDateString() != thisMonday.toDateString())
						continue;
					// sort matches into confirmed and unconfirmed
					if (user_matches[n].confirmed)
						confirmed_matches.push(user_matches[n]);
					else
						unconfirmed_matches.push(user_matches[n]);
				}
				var str = `${tag(message.author.id)}\n${mention.username}'s matches (${confirmed_matches.length + unconfirmed_matches.length}/${config.maximum_weekly_challenges}):\n`;
				if (unconfirmed_matches.length > 0) {
					str += `------Unconfirmed------\n`;
					for (var n in unconfirmed_matches) {
						var match = unconfirmed_matches[n];
						// was the submitter the user?
						var submitter_was_user = match.player_id == target_id;
						// set player ids based on whether the user submitted the match
						var opponent_id;
						var player_id;
						if (submitter_was_user) {
							opponent_id = match.opponent_id;
							player_id = match.player_id;
						} else {
							opponent_id = match.player_id;
							player_id = match.opponent_id;
						}
						// create a string of the match result (win/loss)
						var match_result_string;
						match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss';
						// get player user data
						var player_data = await db.getUserDataUsingId(player_id);
						if (!player_data) {
							// could not get the player's data from their user id
							message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
							throw (`Could not getUserDataUsingId(${player_id})`);
						}
						// get opponent user data
						var opponent_data = await db.getUserDataUsingId(opponent_id);
						if (!opponent_data) {
							// could not get the other player's data from their user id
							message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
							throw (`Could not getUserDataUsingId(${opponent_id})`);
						}
						// construct match result message
						text = '';
						submitter_was_user ?
							text += strings.matches_submitter_was_user :
							text += strings.matches_submitter_was_not_user;
						str += text
							.replaceAll('{player_name}', player_data.discord_username)
							.replaceAll('{opponent_name}', opponent_data.discord_username)
							.replaceAll('{match_id}', match.id)
							.replaceAll('{winloss}', match_result_string);
					}
				}
				if (confirmed_matches.length > 0) {
					str += `------Confirmed------\n`;
					for (var n in confirmed_matches) {
						var match = confirmed_matches[n];
						// was the submitter the user?
						var submitter_was_user = match.player_id == target_id;
						// set player ids based on whether the user submitted the match
						var opponent_id;
						var player_id;
						if (submitter_was_user) {
							opponent_id = match.opponent_id;
							player_id = match.player_id;
						} else {
							opponent_id = match.player_id;
							player_id = match.opponent_id;
						}
						// create a string of the match result (win/loss)
						var match_result_string;
						match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss';
						// get player user data
						var player_data = await db.getUserDataUsingId(player_id);
						if (!player_data) {
							// could not get the player's data from their user id
							message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
							throw (`Could not getUserDataUsingId(${player_id})`);
						}
						// get opponent user data
						var opponent_data = await db.getUserDataUsingId(opponent_id);
						if (!opponent_data) {
							// could not get the other player's data from their user id
							message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
							throw (`Could not getUserDataUsingId(${opponent_id})`);
						}
						// construct match result message
						text = '';
						submitter_was_user ?
							text += strings.matches_submitter_was_user :
							text += strings.matches_submitter_was_not_user;
						str += text
							.replaceAll('{player_name}', player_data.discord_username)
							.replaceAll('{opponent_name}', opponent_data.discord_username)
							.replaceAll('{match_id}', match.id)
							.replaceAll('{winloss}', match_result_string);
					}
				}
				message.channel.send(str);
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// ensure the user is registered
			if (!user) {
				// not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// get the user's matches
			var user_matches = await db.getAllUserMatches(user.id);
			if (!user_matches) {
				message.channel.send(strings.matches_no_recent_matches.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			var confirmed_matches = [];
			var unconfirmed_matches = [];
			// loop through user's matches
			for (var n in user_matches) {
				// sort out matches which are confirmed or did not happen this week
				let thisMonday = getMonday(new Date());
				let matchMonday = getMonday(new Date(user_matches[n].timestamp));
				if (user_matches[n].confirmed && matchMonday.toDateString() != thisMonday.toDateString())
					continue;
				// sort matches into confirmed and unconfirmed
				if (user_matches[n].confirmed)
					confirmed_matches.push(user_matches[n]);
				else
					unconfirmed_matches.push(user_matches[n]);
			}
			var str = `${tag(message.author.id)} this week's matches (${confirmed_matches.length + unconfirmed_matches.length}/${config.maximum_weekly_challenges}):\n`;
			if (unconfirmed_matches.length > 0) {
				str += `------Unconfirmed------\n`;
				for (var n in unconfirmed_matches) {
					var match = unconfirmed_matches[n];
					// was the submitter the user?
					var submitter_was_user = match.player_id == user.id;
					// get the other player's user id
					var opponent_id;
					submitter_was_user ? opponent_id = match.opponent_id : opponent_id = match.player_id;
					// create a string of the match result (win/loss)
					var match_result_string;
					match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss';
					// get opponent user data
					var opponent_data = await db.getUserDataUsingId(opponent_id);
					if (!opponent_data) {
						// could not get the other player's data from their user id
						message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
						throw (`Could not getUserDataUsingId(${opponent_id})`);
					}
					// construct match result message
					text = '';
					submitter_was_user ?
						text += strings.matches_submitter_was_user :
						text += strings.matches_submitter_was_not_user;
					str += text
						.replaceAll('{player_name}', tag(message.author.id))
						.replaceAll('{opponent_name}', opponent_data.discord_username)
						.replaceAll('{match_id}', match.id)
						.replaceAll('{winloss}', match_result_string);
				}
			}
			if (confirmed_matches.length > 0) {
				str += `------Confirmed------\n`;
				for (var n in confirmed_matches) {
					var match = confirmed_matches[n];
					// was the submitter the user?
					var submitter_was_user = match.player_id == user.id;
					// get the other player's user id
					var opponent_id;
					submitter_was_user ? opponent_id = match.opponent_id : opponent_id = match.player_id;
					// create a string of the match result (win/loss)
					var match_result_string;
					match.result == MatchResult.WIN ? match_result_string = 'win' : match_result_string = 'loss';
					// get opponent user data
					var opponent_data = await db.getUserDataUsingId(opponent_id);
					if (!opponent_data) {
						// could not get the other player's data from their user id
						message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
						throw (`Could not getUserDataUsingId(${opponent_id})`);
					}
					// construct match result message
					text = '';
					submitter_was_user ?
						text += strings.matches_submitter_was_user :
						text += strings.matches_submitter_was_not_user;
					str += text
						.replaceAll('{player_name}', tag(message.author.id))
						.replaceAll('{opponent_name}', opponent_data.discord_username)
						.replaceAll('{match_id}', match.id)
						.replaceAll('{winloss}', match_result_string);
				}
			}
			message.channel.send(str);
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// admin command, allows showing/updating/deleting match information
		// matchinfo command, allows admins to see match information with match id
		case 'admin':
			// require admin
			if (!admin) {
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			if (args.length == 1) {
				switch (args[0]) {
					// channels command, shows channels being used by bot
					case 'channels':
						// list channels
						var msg = '';
						for (i = 0; i < discord_channels_to_use.length; i++)
							msg += `${discord_channels_to_use[i]}:${client.channels.get(discord_channels_to_use[i])}\n`;
						message.channel.send(strings.channels_list.replaceAll('{user}', tag(message.author.id)).replaceAll('{channels}', msg));
						break;
					// init command, to initialize a channel for use by the bot
					case 'init':
						var channels = discord_channels_to_use;
						// loop through channels, check if current channel is already added
						if (channels != undefined) {
							if (channels.includes(message.channel.id)) {
								message.channel.send(strings.init_already_using_channel.replaceAll('{user}', tag(message.author.id)).replaceAll('{channel_id}', message.channel.id).replaceAll('{channel_name}', message.channel.name));
								break;
							}
							// add current channel to channels list
							channels.push(message.channel.id);
						} else
							// add current channel to channels list
							channels = [message.channel.id];
						// write data to file
						await fm.writeFile('./channels.json', JSON.stringify({ data: channels }), (err) => {
							if (err) throw err;
						});
						discord_channels_to_use = require('./channels.json').data;
						// success, list channels
						var msg = '';
						for (i = 0; i < discord_channels_to_use.length; i++)
							msg += `${discord_channels_to_use[i]}:${client.channels.get(discord_channels_to_use[i])}\n`;
						message.channel.send(strings.init_success.replaceAll('{user}', tag(message.author.id)).replaceAll('{channels}', msg));
						break;
					// deinit command, makes the bot stop using a channel
					case 'deinit':
						// check if channel is being used currently
						var channels = discord_channels_to_use;
						if (channels == undefined || !channels.includes(message.channel.id)) {
							message.channel.send(strings.deinit_not_using_channel.replaceAll('{user}', tag(message.author.id)).replaceAll('{channel_id}', message.channel.id).replaceAll('{channel_name}', message.channel.name));
							break;
						}
						// stop using this channel
						channels.splice(channels.indexOf(message.channel.id), 1);
						await fm.writeFile('./channels.json', JSON.stringify({ data: channels }), (err) => {
							message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
							log.error(err);
						});
						// refresh the channels list
						discord_channels_to_use = require('./channels.json').data;
						// list channels
						var msg = '';
						for (i = 0; i < discord_channels_to_use.length; i++)
							msg += `${discord_channels_to_use[i]}:${client.channels.get(discord_channels_to_use[i])}\n`;
						message.channel.send(strings.deinit_success.replaceAll('{user}', tag(message.author.id)).replaceAll('{channels}', msg));
						break;
					// help command, shows admin help
					case 'help':
						msg = `${tag(message.author.id)}\n${strings.admin_help}`;
						message.channel.send(msg.replaceAll('{user}', tag(message.author.id)));
						break;
					case 'avg':
						var avg = await db.getAverageElo();
						var compAvg = await db.getAverageCompetingElo();
						message.channel.send(`Average ELO: ${avg}\nAverage competing ELO: ${compAvg}`);
						break;
					default:
						msg = `${tag(message.author.id)}\n${strings.admin_help}`;
						message.channel.send(msg.replaceAll('{user}', tag(message.author.id)));
						break;
				}
			} else if (args.length == 2) {
				// get match
				var match = await db.getMatch(args[1]);
				if (!match) {
					message.channel.send(strings.match_not_found.replaceAll('{match_id}', args[1]));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					break;
				}
				// get player data
				var player_data = await db.getUserDataUsingId(match.player_id);
				if (!player_data)
					throw (`Could not getUserDataUsingId(${match.player_id})`);
				// get opponent data
				var opponent_data = await db.getUserDataUsingId(match.opponent_id);
				if (!opponent_data)
					throw (`Could not getUserDataUsingId(${match.opponent_id})`);
				switch (args[0]) {
					// match command, shows match info
					case 'info':
					case 'match':
						var msg = '';
						for (var e in match)
							msg += `${e}: ${match[e]}\n`;
						message.channel.send(`\`\`\`${msg}\`\`\``);
						break;
					// admin confirm command, confirms a pending match
					case 'confirm':
						// is the match already confirmed?
						if (match.confirmed) {
							message.channel.send(`Game ${match.id} is already confirmed.`);
							break;
						}
						// get player's elo rating
						var playerElo = await db.getUserEloRating(match.player_id);
						if (!playerElo)
							throw (`Could not getUserEloRating(${match.player_id})`);
						// get opponent's elo rating
						var opponentElo = await db.getUserEloRating(match.opponent_id);
						if (!opponentElo)
							throw (`Could not getUserEloRating(${match.opponent_id})`);
						// calculate elo
						var eloCalculation = calculateElo(playerElo, opponentElo, match.player_start_elo, match.opponent_start_elo, match.player_end_elo, match.opponent_end_elo, match.result);
						// set player's new elo rating
						await db.setUserEloRating(match.player_id, eloCalculation.new_player_elo);
						// set target's new elo rating
						await db.setUserEloRating(match.opponent_id, eloCalculation.new_opponent_elo);
						// update match
						await db.updateMatch(match.id, true, match.player_start_elo, match.player_start_elo + eloCalculation.net_player_elo, match.opponent_start_elo, match.opponent_start_elo + eloCalculation.net_opponent_elo);
						// get player's new rank
						var player_rank = await db.getUserEloRanking(match.player_id);
						if (!player_rank)
							throw (`Could not getUserEloRanking(${match.player_id})`);
						// get opponent's new rank
						var opponent_rank = await db.getUserEloRanking(match.opponent_id);
						if (!opponent_rank)
							throw (`Could not getUserEloRanking(${match.opponent_id})`);
						// message players
						var winloss;
						match.result ? winloss = 'win' : winloss = 'loss';
						await message.channel.send(strings.pending_confirm
							.replaceAll('{new_elo_message}', strings.new_elo_message)
							.replaceAll('{match_id}', match.id)
							.replaceAll('{winloss}', winloss)
							.replaceAll('{user}', tag(message.author.id))
							.replaceAll('{player}', tag(player_data.discord_id))
							.replaceAll('{opponent}', tag(opponent_data.discord_id))
							.replaceAll('{player_name}', player_data.discord_username)
							.replaceAll('{opponent_name}', opponent_data.discord_username)
							.replaceAll('{player_elo_rank}', player_rank)
							.replaceAll('{opponent_elo_rank}', opponent_rank)
							.replaceAll('{old_player_elo}', playerElo)
							.replaceAll('{new_player_elo}', eloCalculation.new_player_elo)
							.replaceAll('{old_opponent_elo}', opponentElo)
							.replaceAll('{new_opponent_elo}', eloCalculation.new_opponent_elo));
						break;
					// cancel command, allows admins to nullify a pending match with match id
					case 'cancel':
						// is the match already confirmed?
						if (!match.confirmed) {
							message.channel.send(`Game ${match.id} is not confirmed.`);
							break;
						}
						// get player's elo rating
						var playerElo = await db.getUserEloRating(match.player_id);
						if (!playerElo)
							throw (`Could not getUserEloRating(${match.player_id})`);
						// get opponent's elo rating
						var opponentElo = await db.getUserEloRating(match.opponent_id);
						if (!opponentElo)
							throw (`Could not getUserEloRating(${match.opponent_id})`);
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
							throw (`Could not getUserEloRanking(${match.player_id})`);
						}
						// get opponent's new rank
						var opponent_rank = await db.getUserEloRanking(match.opponent_id);
						if (!opponent_rank) {
							message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
							throw (`Could not getUserEloRanking(${match.opponent_id})`);
						}
						// message players
						var winloss;
						match.result ? winloss = 'win' : winloss = 'loss';
						await message.channel.send(strings.cancel_match_cancel
							.replaceAll('{new_elo_message}', strings.new_elo_message)
							.replaceAll('{match_id}', match.id)
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
							.replaceAll('{new_opponent_elo}', newOpponentElo));
						break;
					// nullify command, deletes a game result
					case 'nullify':
						// is the match already confirmed?
						if (match.confirmed) {
							// get player's elo rating
							var playerElo = await db.getUserEloRating(match.player_id);
							if (!playerElo)
								throw (`Could not getUserEloRating(${match.player_id})`);
							// get opponent's elo rating
							var opponentElo = await db.getUserEloRating(match.opponent_id);
							if (!opponentElo)
								throw (`Could not getUserEloRating(${match.opponent_id})`);
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
							// set opponent's new elo rating
							await db.setUserEloRating(match.opponent_id, newOpponentElo);
							// update the match info
							await db.setMatchResultConfirmed(match.id, false);
							// get player's new rank
							var player_rank = await db.getUserEloRanking(match.player_id);
							if (!player_rank) {
								message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
								throw (`Could not getUserEloRanking(${match.player_id})`);
							}
							// get opponent's new rank
							var opponent_rank = await db.getUserEloRanking(match.opponent_id);
							if (!opponent_rank) {
								message.channel.send(strings.generic_error.replaceAll('{user}', tag(message.author.id)));
								throw (`Could not getUserEloRanking(${match.opponent_id})`);
							}
							// message players
							var winloss;
							match.result ? winloss = 'win' : winloss = 'loss';
							await message.channel.send(strings.cancel_match_cancel
								.replaceAll('{new_elo_message}', strings.new_elo_message)
								.replaceAll('{match_id}', match.id)
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
								.replaceAll('{new_opponent_elo}', newOpponentElo));
						}
						await db.deleteMatch(match.id);
						await message.channel.send(`${tag(message.author.id)} deleted match ${match.id}.`)
						break;
					default: break;
				}
			}
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			break;
		// top command, shows top 25 competing players by elo
		case 'top':
			if (args.length != 0) {
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			// get top players
			var top_players = await db.getTopCompetingPlayers(25);
			if (!top_players) {
				message.channel.send(strings.could_not_get_top_players.replaceAll('{user}', tag(message.author.id)));
				// remove command message from pending user responses
				user_commands_running.delete(message.id);
				break;
			}
			var players = [];
			for (var p in top_players) {
				var numMatches = await db.getUserNumConfirmedMatches(top_players[p].id);
				if (numMatches && numMatches.length >= config.provisional_matches)
					players.push(top_players[p]);
			}
			if (players.length > 0) {
				// construct message
				var msg = '';
				for (i = 0; i < players.length; i++)
					msg += `\`${(i + 1)}. ${players[i].discord_username}: ${players[i].elo_rating}\`\n`;
				message.channel.send(strings.top_players.replaceAll('{top_players}', msg));
			} else
				message.channel.send(strings.no_top_players.replaceAll('{user}', tag(message.author.id)));
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
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
function eloRatingCalculation(playerElo, opponentElo, result) {
	return eloRating.calculate(playerElo, opponentElo, result, config.elo_k);
}

/**
 * 
 * @param {int} playerElo current player elo
 * @param {int} opponentElo current opponent elo
 * @param {int} player_start_elo player start elo in match
 * @param {int} opponent_start_elo opponent start elo in match
 * @param {int} player_end_elo player end elo in match
 * @param {int} opponent_end_elo opponent end elo in match
 * @param {boolean} result match result
 */
function calculateElo(playerElo, opponentElo, player_start_elo, opponent_start_elo, player_end_elo, opponent_end_elo, result) {
	// calculate new elo
	var newPlayerElo = playerElo;
	var newOpponentElo = opponentElo;
	var net_player_elo = 0;
	var net_opponent_elo = 0;
	if (player_start_elo != null && opponent_start_elo != null) {
		// match has players' start elo
		if (player_end_elo != null && opponent_end_elo != null) {
			// match has players' end elo
			if (result) {
				// player won game
				newPlayerElo = playerElo + Math.abs(player_end_elo - player_start_elo);
				newOpponentElo = opponentElo - Math.abs(opponent_start_elo - opponent_end_elo);
			} else {
				// player lost game
				newPlayerElo = playerElo - Math.abs(player_start_elo - player_end_elo);
				newOpponentElo = opponentElo + Math.abs(opponent_end_elo - opponent_start_elo);
			}
		} else {
			var elo = eloRatingCalculation(playerElo, opponentElo, result);
			if (result) {
				// player won game
				newPlayerElo = playerElo + Math.abs(elo.playerRating - playerElo) + config.bonus_elo;
				newOpponentElo = opponentElo - Math.abs(opponentElo - elo.opponentRating) + config.bonus_elo;
			} else {
				// player lost game
				newPlayerElo = playerElo - Math.abs(elo.playerRating - playerElo) + config.bonus_elo;
				newOpponentElo = opponentElo + Math.abs(opponentElo - elo.opponentRating) + config.bonus_elo;
			}
		}
	} else {
		// no start elo in match, calculate new elo
		var elo = eloRatingCalculation(playerElo, opponentElo, result);
		newPlayerElo = elo.playerRating + config.bonus_elo;
		newOpponentElo = elo.opponentRating + config.bonus_elo;
	}
	if (result) {
		net_player_elo = newPlayerElo - playerElo;
		net_opponent_elo = newOpponentElo - opponentElo;
	} else {
		net_player_elo = playerElo - newPlayerElo;
		net_opponent_elo = opponentElo - newOpponentElo;
	}
	return { new_player_elo: newPlayerElo, new_opponent_elo: newOpponentElo, net_player_elo: net_player_elo, net_opponent_elo: net_opponent_elo };
}

// gets the date of the previous monday of this week
function getMonday(d) {
	d = new Date(d);
	var day = d.getDay(),
		diff = d.getDate() - day + (day == 0 ? -6 : 1); // adjust when day is sunday
	return new Date(d.setDate(diff));
}

// replaces all occurrences of a substring with a substring
String.prototype.replaceAll = function (search, replacement) {
	var target = this;
	return target.split(search).join(replacement);
}

async function decayInactiveElo(amount) {
	var decayed = [];
	var toDecay = await db.getUsersToDecayElo();
	for (var u in toDecay) {
		let user = toDecay[u];
		let newElo = user.elo_rating - amount;
		await db.setUserEloRating(user.id, newElo);
		decayed.push({ id: user.id, discord_username: user.discord_username, old_elo: user.elo_rating, new_elo: newElo });
	}
	return decayed;
}
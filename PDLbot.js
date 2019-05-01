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
const package = require('./package.json');

// enums
const MatchResult = { WIN: 1, LOSS: 0 };
const ReactionEmoji = { THUMBS_UP: '👍', THUMBS_DOWN: '👎', CANCEL: '🇽', CONFIRMED: '✅', CANCELLED: '🔷' };
exports = MatchResult;

// runtime variables
var botChannels,
	started = false,
	guild;

// configure logger settings
log.remove(log.transports.Console);
log.add(new log.transports.Console, { colorize: true });
log.level = 'debug';

// initialize discord client
const client = new discord.Client();
client.login(config_db.bot_token).catch((err) => {
	log.error('Could not connect to discord servers:');
	log.error(err.message);
	client.destroy();
});
// called when the bot starts up
client.once('ready', async () => {
	log.info(`Starting ${client.user.username} v${package.version} - (${client.user.id})`);
	// set guild based on guild id in config
	guild = await client.guilds.get(config.guild_id);
	// ensure the guild was found
	if (guild != null) {
		log.info(`Guild ${guild.name} (${guild.id}) found.`);
	} else {
		// guild ID in the config is incorrect or not set
		log.error(`Could not find discord guild with guild ID specified in config.js, shutting down.`);
		client.destroy();
		process.exit(1);
	}
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
	// connect to database and check tables
	await db.connect();
	await db.checkTables();
	// retrieve channels to use from database
	botChannels = await db.getChannels();
	// job runs 59 seconds after 12am Monday
	schedule.scheduleJob('WeeklyEloQuit', '59 0 0 * * 1', async () => {
		// weekly auto-quit, if enabled
		if (config.auto_quit) {
			var autoQuitChannel = client.channels.get(config.auto_quit_channel);
			if (autoQuitChannel) {
				// auto quit users after n weeks of inactivity
				var quit = [];
				var competing = await db.getTopCompetingPlayers(-1);
				for (var i = 1; i < competing.length; i++) {
					var matches = await db.getUserRecentMatches(competing[i].id, config.auto_quit_weeks);
					if (!matches) {
						var member = await guild.members.find(member => member.id.toString() === competing[i].discord_id.toString());
						if (member != null) {
							await quitUser(member.user.id);
							console.log(`Auto-quit ${await getDiscordUsernameFromDiscordId(member.user.id)} for being AFK for ${config.auto_quit_weeks} weeks.`);
							quit.push(competing[i].discord_id);
						}
					}
				}
				if (quit.length > 0) {
					var msg = strings.auto_quit_message.replaceAll('{weeks}', config.auto_quit_weeks) + '\n';
					for (var i = 0; i < quit.length; i++) {
						msg += `${tag(quit[i])}\n`
					}
					autoQuitChannel.send(msg);
				}

				// warn users that they will be auto-quit after n weeks of inactivity
				var warned = [];
				var competing = await db.getTopCompetingPlayers(-1);
				for (var i = 1; i < competing.length; i++) {
					var matches = await db.getUserRecentMatches(competing[i].id, config.auto_quit_weeks - 1);
					if (!matches) {
						warned.push(competing[i].discord_id);
					}
				}
				msg = strings.auto_quit_warning_message.replaceAll('{weeks}', config.auto_quit_weeks) + '\n';
				for (var i = 0; i < warned.length; i++) {
					msg += `${tag(warned[i])}`;
					if (i != warned.length - 1)
						msg += `, `;
				}
				autoQuitChannel.send(msg);
			} else {
				log.error(`Could not find auto_quit_channel '${config.auto_quit_channel}' as defined in config.js`);
			}
		}
		// weekly elo decay, if enabled
		if (config.weekly_elo_decay) {
			var weeklyEloDecayChannel = client.channels.get(config.weekly_elo_decay_channel);
			if (weeklyEloDecayChannel) {
				// decay inactive users and get a list of users whose elo has been decayed
				var decayed = await decayInactiveElo(config.weekly_elo_decay_amount);
				// string to contain decayed players' usernames and old/new elo
				var decayedStr = '';
				// construct player list for message
				if (decayed.length > 0) {
					log.info(`Decayed the following players ELO by ${config.weekly_elo_decay_amount}:`);
					for (var p in decayed) {
						decayedStr += `${tag(decayed[p].discord_id)}: ${decayed[p].old_elo}->${decayed[p].new_elo}\n`
						log.info(`(${decayed[p].id}:${decayed[p].discord_username}):${decayed[p].old_elo}->${decayed[p].new_elo}`);
					}
				}
				// send message to channel
				weeklyEloDecayChannel.send(strings.weekly_challenge_reset.replaceAll('{matchlimit}', config.maximum_weekly_challenges));
				if (decayed.length > 0)
					weeklyEloDecayChannel.send(strings.weekly_elo_decay.replaceAll('{players}', decayedStr));
				log.info(`${new Date()}: ELO Decayed`);
			} else {
				log.error(`Could not find weekly_elo_decay_channel '${config.weekly_elo_decay_channel}' as defined in config.js`);
			}
		}
	});
	// setup weekly matchup suggestions, if enabled
	if (config.suggested_weekly_matchups_channel != '0') {
		// job runs at 1pm EST on Monday
		schedule.scheduleJob('WeeklyMatchups', '0 0 13 * * 1', async () => {
			// get the channel
			var channel = guild.channels.get(config.suggested_weekly_matchups_channel);
			// check if the channel exists
			if (channel)
				// run matchup suggestion function, which will save the matchups in the database
				suggestMatchups(channel, true, true);
		});
	}
	// startup complete
	started = true;
	log.info(`${client.user.username} startup complete!`);
});

// called when a new member joins the discord server
client.on('guildMemberAdd', member => {
	// get the channel
	var channel = member.guild.channels.get(config.welcome_channel);
	// check if the channel exists
	if (channel != null)
		// send welcome message
		channel.send(strings.welcome_message.replaceAll('{user_tag}', tag(member.user.id)).replaceAll('{user_name}', member.user.username));
	else
		log.error('Channel to use for welcome message could not be found with the channel ID in the config.');
});

client.on('guildMemberRemove', async member => {
	// get user's database id
	var user_id = await db.getUserIdFromDiscordId(member.user.id);
	if (!user_id) return;
	var quit = await quitUser(member.user.id);
	if (quit) log.info(`${member.user.username} has quit by leaving the server.`);
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
		message.channel.send(strings.error_one_command_at_a_time.replaceAll('{user}', tag(message.author.id)));
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
		user = await new User(user_id, db, client).init();
	// create cmd and args variables
	var args = message.content.substring(1).split(' ');
	const cmd = args[0].toLocaleLowerCase();
	args = args.splice(1);
	// check if user is admin
	// get admin role
	let adminRole = await guild.roles.find(role => role.name === config.admin_role_name);
	var admin = adminRole != null && adminRole.id != undefined && message.member.roles.has(adminRole.id);
	// find channel type
	var channelMatchFormat;
	for (var c in botChannels)
		if (botChannels[c].channel_id.toString() === message.channel.id.toString())
			channelMatchFormat = botChannels[c].type;
	// ignore command if the channel type isn't found (channel not initialized) or the command isn't !admin
	if (!channelMatchFormat && cmd != 'admin') {
		// remove command message from pending user responses
		user_commands_running.delete(message.id);
		return;
	}

	// top command, shows top competing teams ordered by elo
	if (cmd === 'top' && args.length > -1 && args.length < 2) {
		var numTop = config.top_players;
		// parse amount argument if admin
		if (admin && args.length == 1 && !isNaN(parseInt(args[0])))
			numTop = parseInt(args[0]);
		// get top list
		var topList = await db.getTopCompetingTeams(channelMatchFormat, numTop);
		if (!topList) {
			// couldn't get top teams
			message.channel.send(strings.could_not_get_top_players.replaceAll('{user}', tag(message.author.id)));
			// remove command message from pending user responses
			user_commands_running.delete(message.id);
			return;
		}
		if (topList.length > 0) {
			// construct message
			var msg = '';
			// loop through teams and append to message
			for (i = 0; i < topList.length; i++) {
				// get player username
				var team;
				if (channelMatchFormat === '1v1')
					team = await getDiscordUsernameFromDiscordId(topList[i].discord_id);
				else
					team = topList[i].name
				// construct one line of the message
				msg += `\`${i + 1}. ${team}: ${topList[i].elo_rating}\`\n`;
			}
			// send it
			message.channel.send(strings.top_players.replaceAll('{top_players}', msg).replaceAll('{number}', topList.length));
		} else
			// no top teams
			message.channel.send(strings.no_top_players.replaceAll('{user}', tag(message.author.id)));
		// remove command message from pending user responses
		user_commands_running.delete(message.id);
		return;
	}

	// matchups command, shows generated weekly matchups
	if (cmd === 'matchups') {
		var players = await db.getWeeklyMatchups();
		// compose matchups message
		var msg = strings.suggested_matchups_message;
		var playerlist_string = '`{player1} vs. {player2}`\n';
		// loop through competing players 2 at a time
		for (var i = 0; i < players.length; i += 2) {
			var p1 = players[i];
			var p2 = players[i + 1];
			// ensure the players aren't null
			if (p1 != null && p2 != null) {
				p1Author = p1.discord_id.toString() === message.author.id.toString();
				p2Author = p2.discord_id.toString() === message.author.id.toString();
				p1Author ?
					p1_username = tag(message.author.id) :
					p1_username = await getDiscordUsernameFromDiscordId(p1.discord_id);
				p2Author ?
					p2_username = tag(message.author.id) :
					p2_username = await getDiscordUsernameFromDiscordId(p2.discord_id);
				if (!p1Author && !p2Author)
					msg += playerlist_string.replaceAll('{player1}', p1_username).replaceAll('{player2}', p2_username);
				else {
					if (p1Author)
						msg += playerlist_string.substring(1).replaceAll('{player1}', tag(message.author.id) + ' `').replaceAll('{player2}', p2_username);
					else {
						var str = playerlist_string.replaceAll('{player1}', p1_username).replaceAll('{player2}', '` ' + tag(message.author.id));
						msg += str.substring(0, str.length - 2) + '\n';
					}
				}
			}
		}
		message.channel.send(msg);
		// remove command message from pending user responses
		user_commands_running.delete(message.id);
		return;
	}

	if (cmd === 'createteam') {
		// TODO: allow team names with spaces
		if (args.length > 0) {
			var pTeam = await db.getPlayerTeam(channelMatchFormat, user.id);
			if (!pTeam) {
				var dbTeam = await db.getTeam(channelMatchFormat, args[0]);
				if (!dbTeam) {
					var teamCreated = await db.createTeam(channelMatchFormat, args[0]);
					if (teamCreated) {
						var team = await db.getTeam(channelMatchFormat, args[0]);
						var addedPlayerToTeam = await db.addPlayerToTeam(channelMatchFormat, user.id, team[0].id);
						if (addedPlayerToTeam) {
							if (!await getTeamRole(args[0])) {
								var role = await guild.createRole({
									name: args[0],
									color: getRandomColor(),
									hoist: true,
									position: guild.roles.size - 2,
									mentionable: true
								});
								if (await guild.member(message.author).addRole(role))
									message.channel.send(`${tag(message.author.id)} has created the team ${tagRole(role.id)}!`);
							} else {
								message.channel.send(`Team ${args[0]} already exists!`);
							}
						} else {
							message.channel.send(`An error occurred, an ${tagRole(adminRole.id)} has been notified.`);
							log.error(`Couldn't add player ${await getDiscordUsernameFromDiscordId(message.author.id)} to team ${team[0].name}`);
						}
					} else {
						message.channel.send(`An error occurred, an ${tagRole(adminRole.id)} has been notified.`);
						log.error(`Couldn't create team ${args[0]} for ${await getDiscordUsernameFromDiscordId(message.author.id)}`);
					}
				} else {
					message.channel.send(`Team "${args[0]}" already exists!`);
				}
			} else {
				message.channel.send(`You are already on team ${pTeam[0].name}!`);
			}
		} else {
			message.channel.send(`Usage: !createteam <teamname>`);
		}
	}

	if (cmd === 'jointeam') {
		var roleMention = message.mentions.roles.values().next().value;
		if (args.length == 1 || (args.length == 1 && roleMention)) {
			var pTeam = await db.getPlayerTeam(channelMatchFormat, user.id);
			if (!pTeam) {
				// TODO: team capitalization and spaces
				var teamName;
				if (roleMention)
					teamName = roleMention.name;
				else
					teamName = args[0];
				team = await db.getTeam(channelMatchFormat, teamName);
				if (team) {
					//TODO: check the database for an invite
					var teamRole = await getTeamRole(teamName);
					if (teamRole) {
						var dbJoin = await db.addPlayerToTeam(channelMatchFormat, user.id, team[0].id);
						if (dbJoin) {
							if (await guild.member(message.author).addRole(teamRole)) {
								message.channel.send(`${tag(message.author.id)} has joined the team ${tagRole(teamRole.id)}!`);
							} else {
								message.channel.send(`An error occurred, an ${tagRole(adminRole.id)} has been notified.`);
								log.error(`Couldn't add team role ${team.name} to ${await getDiscordUsernameFromDiscordId(message.author.id)}`)
							}
						} else {
							message.channel.send(`An error occurred, an ${tagRole(adminRole.id)} has been notified.`);
							log.error(`Couldn't add ${await getDiscordUsernameFromDiscordId(message.author.id)} to ${team[0].name} in DB`);
						}
					} else {
						message.channel.send(`Couldn't find the team role ${teamName}`);
					}
				} else {
					message.channel.send(`Couldn't find the team ${teamName}`);
				}
			} else {
				message.channel.send(`Already a member of team ${pTeam[0].name}`);
			}
		} else {
			message.channel.send(`Usage: !join <teamname>`);
		}
	}

	if (cmd === 'leaveteam') {
		var pTeam = await db.getPlayerTeam(channelMatchFormat, user.id);
		if (pTeam) {
			if (args.length == 0) {
				var teamRole = await getTeamRole(pTeam[0].name);
				if (teamRole && guild.member(message.author)._roles.includes(teamRole.id)) {
					var removedRole = await guild.member(message.author).removeRole(teamRole);
					if (removedRole) {
						var leftTeam = await db.removePlayerFromTeam(channelMatchFormat, user.id);
						if (leftTeam.length > 0)
							message.channel.send(`${tag(message.author.id)} has left team ${tagRole(teamRole.id)}!`);
						else {
							disbandedTeam = await db.disbandTeam(channelMatchFormat, pTeam[0].name);
							if (disbandedTeam) {
								await message.channel.send(`Team ${tagRole(teamRole.id)} has been disbanded!`);
								teamRole.delete();
							} else
								message.channel.send(`Couldn't disband team ${tagRole(teamRole.id)}`);
						}
					} else
						message.channel.send(`Couldn't remove role ${tagRole(teamRole.id)} from ${tag(message.author.id)}`);
				} else {
					message.channel.send(`${tag(message.author.id)} you are not currently part of a team!`);
				}
			} else
				message.channel.send(`Usage: !leaveteam`);
		} else
			message.channel.send(`${tag(message.author.id)} you are not currently part of a team!`);
	}

	if (cmd === 'invite') {
		if (user) {
			var pTeam = await db.getPlayerTeam(channelMatchFormat, user.id);
			if (pTeam) {
				var userMention = message.mentions.users.values().next().value;
				if (args.length == 1 && userMention) {
					var targetUser = await new User(await db.getUserIdFromDiscordId(userMention.id), db, client).init();
					if (targetUser) {
						var inviteTo = await db.getInvite(channelMatchFormat, false, targetUser.id);
						if (!inviteTo || (inviteTo && (inviteTo[0].team !== pTeam[0].id))) {
							// create invite
							var invite = await db.createInvite(channelMatchFormat, pTeam[0].id, user.id, targetUser.id);
							if (invite)
								message.channel.send(`${tag(userMention.id)} has been invited to ${pTeam[0].name} by ${tag(message.author.id)}`);
							else
								message.channel.send(`Couldn't invite ${await getDiscordUsernameFromDiscordId(userMention.id)}`);
						} else
							message.channel.send(`${tag(message.author.id)} ${await getDiscordUsernameFromDiscordId(userMention.id)} has already been invited to ${pTeam[0].name}.`);
					} else
						message.channel.send(`${tag(message.author.id)} ${await getDiscordUsernameFromDiscordId(userMention.id)} is not registered.`);
				} else
					message.channel.send(`Usage: !invite @<user>`);
			} else
				message.channel.send(`${tag(message.author.id)} you are not currently part of a team!`);
		} else
			message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
	}

	if (cmd === 'disbandteam') {
		//TODO: check the database for the team
		// requires majority of team members to confirm to disband
	}

	if (cmd === 'teamname') {
		// TODO: allow team names with spaces
		if (user) {
			var pTeam = await db.getPlayerTeam(channelMatchFormat, user.id);
			if (pTeam) {
				var tTeam = await db.getTeam(channelMatchFormat, args[0])
				if (!tTeam) {
					var role = await getTeamRole(pTeam[0].name);
					if (role) {
						if (args.length == 1) {
							var oldName = pTeam[0].name;
							var teamNameSet = await db.modifyTeam(channelMatchFormat, pTeam[0].name, 'name', args[0]);
							if (teamNameSet) {
								var teamRoleNameSet = await role.setName(args[0]);
								if (teamRoleNameSet) {
									message.channel.send(`Renamed team ${oldName} to ${tagRole(role.id)}`);
								}
							} else {
								message.channel.send(`An error occurred, an ${tagRole(adminRole.id)} has been notified.`);
								console.log(`Couldn't rename team ${pTeam[0].name} to ${args[0]}`);
							}
						} else
							message.channel.send(`${tag(message.author.id)} please specify your new team name.`);
					} else
						message.channel.send(`Couldn't find the role for team ${pTeam[0].name}`);
				} else
					message.channel.send(`${tag(message.author.id)} team ${args[0]} already exists!`);
			} else
				message.channel.send(`${tag(message.author.id)} you are not currently part of a team!`);
		} else
			message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
	}

	if (cmd === 'teamcolor') {
		if (user) {
			var pTeam = await db.getPlayerTeam(channelMatchFormat, user.id);
			if (pTeam) {
				var role = await getTeamRole(pTeam[0].name);
				if (role) {
					if (args.length == 1)
						await role.setColor(args[0]);
					else if (args.length < 1)
						await role.setColor(getRandomColor());
					message.channel.send(`Team ${tagRole(role.id)} color is now ${role.color}`);
				} else
					message.channel.send(`Couldn't find the role for team ${pTeam[0].name}`);
			} else
				message.channel.send(`${tag(message.author.id)} you are not currently part of a team!`);
		} else
			message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
	}

	if (cmd === 'team' && admin) {
		var role = message.mentions.roles.values().next().value;
		var member = message.mentions.members.values().next().value;
		if (args.length < 2 || (args.length == 1 && (role || member))) {
			var team;
			if (args.length == 1)
				if (role) {
					team = await db.getTeam(channelMatchFormat, role.name);
				} else if (member) {
					team = await db.getPlayerTeam(channelMatchFormat, await db.getUserIdFromDiscordId(member.id));
				} else {
					team = await db.getTeam(channelMatchFormat, args[0]);
				}
			else
				team = await db.getPlayerTeam(channelMatchFormat, user.id);
			if (team) {
				var msg = `${tag(message.author.id)}\n\`\`\``;
				for (var t in team[0]) {
					msg += `${t}: ${team[0][t]}\n`;
				}
				message.channel.send(`${msg}\`\`\``);
			} else
				if (args[0])
					message.channel.send(`${tag(message.author.id)} couldn't find the team ${args[0]}`);
				else
					message.channel.send(`${tag(message.author.id)} you are not currently on a team.`);
		} else
			message.channel.send(`${tag(message.author.id)} Usage: !team <teamname>`);
	}

	switch (cmd) {
		// version command, shows current bot version
		case 'version':
			message.channel.send(`v${package.version}`);
			break;
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
				// check if target exists
				var target = await new User(mention_id, db, client).init();
				if (!target) {
					message.channel.send(`${tag(message.author.id)} no data to display.`);
					break;
				}
				// compose and send message containing user data
				var msg = '';
				for (var elem in target)
					msg += `${elem}: ${target[elem]}\n`;
				message.channel.send(`${tag(message.author.id)}\n\`\`\`javascript\n${msg}\`\`\``);
				break;
			}
			// check if user is registered
			if (!user) {
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// compose and send message containing user data
			var msg = '';
			for (var elem in user)
				msg += `${elem}: ${user[elem]}\n`;
			message.channel.send(`${tag(message.author.id)}\n\`\`\`javascript\n${msg}\`\`\``);
			break;
		// help command, shows help dialogue
		case 'help':
			message.channel.send(strings.help.replaceAll('{user}', tag(message.author.id)));
			break;
		// challengeme command, toggles challengeme rank
		case 'challengeme':
			// get challengeme role
			var challengeme = await guild.roles.find(role => role.name === "challengeme");
			if (challengeme == null || challengeme.id == undefined) {
				message.channel.send(`${tag(message.author.id)} could not find role challengeme.`);
				break;
			}
			// ensure the user is registered
			if (!user) {
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// ensure the user is competing
			if (!user.competing) {
				message.channel.send(strings.error_user_not_competing.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// toggle challengeme role on/off
			if (message.member._roles.includes(challengeme.id)) {
				// toggle off
				message.member.removeRole(challengeme);
				message.channel.send(`${tag(message.author.id)} is no longer accepting challenges.`);
			} else {
				// toggle on
				message.member.addRole(challengeme);
				message.channel.send(`${tag(message.author.id)} is now accepting challenges.`);
			}
			break;
		// challenging command, shows users with challengeme rank
		case 'challenging':
			// get challengeme role
			var challengeme = await guild.roles.find(role => role.name === "challengeme");
			if (challengeme == null || challengeme.id == undefined) {
				message.channel.send(`${tag(message.author.id)} could not find role challengeme.`);
				break;
			}
			var targetUser;
			if (args.length == 0) {
				targetUser = user;
			} else if (args.length == 1) {
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					message.channel.send(strings.challenging_no_user_specified);
					break;
				}
				// get target user's database id
				var target_id = await db.getUserIdFromDiscordId(mention.id);
				if (!target_id) {
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id)));
					break;
				}
				targetUser = await new User(target_id, db, client).init();
			}
			// ensure the user is registered
			if (!targetUser) {
				user == targetUser ?
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id))) :
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id)));
				break;
			}
			// ensure the user is competing
			if (!targetUser.competing) {
				user == targetUser ?
					message.channel.send(strings.error_user_not_competing.replaceAll('{user}', tag(message.author.id))) :
					message.channel.send(strings.error_user_not_competing_other.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id)));
				break;
			}
			var hasRole = false;
			if (user == targetUser) {
				hasRole = message.member._roles.includes(challengeme.id);
			} else {
				var member = guild.members.find(member => member.id === mention.id)
				hasRole = member._roles.includes(challengeme.id);
			}
			// tell the player whether they have the challengeme role
			if (targetUser == user)
				hasRole ?
					message.channel.send(strings.user_is_accepting_challenges.replaceAll('{user}', tag(message.author.id))) :
					message.channel.send(strings.user_is_not_accepting_challenges.replaceAll('{user}', tag(message.author.id)));
			else
				hasRole ?
					message.channel.send(strings.user_is_accepting_challenges_other.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id))) :
					message.channel.send(strings.user_is_not_accepting_challenges_other.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id)));
			break;
		// register command, registers the user in the database
		case 'register':
			// require no arguments
			if (args.length != 0) {
				message.channel.send(strings.compete_try_again.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// register user if they're not already in the DB
			if (!user)
				if (await db.registerUser(message.author.id))
					// user registered
					message.channel.send(strings.user_is_now_registered.replaceAll('{user}', tag(message.author.id)));
				else
					// user is already registered
					message.channel.send(strings.error_user_already_registered.replaceAll('{user}', tag(message.author.id)));
			else
				// user is already registered
				message.channel.send(strings.error_user_already_registered.replaceAll('{user}', tag(message.author.id)));
			break;
		// compete command, registers the user in the database and/or enables competing for the user
		case 'compete':
			// require no arguments
			if (args.length != 0) {
				message.channel.send(strings.compete_try_again.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// register user if they're not already in the DB
			if (!user) {
				await db.registerUser(message.author.id);
				// get user's new user ID
				user_id = await db.getUserIdFromDiscordId(message.author.id);
				// create new User class
				user = await new User(user_id, db, client).init();
			} else {
				// check if the user is currently competing
				if (user.competing) {
					message.channel.send(strings.compete_already_competing.replaceAll('{user}', tag(message.author.id)));
					break;
				}
			}
			// check if competitor role is defined in config
			if (config.competitor_role_name != null && config.competitor_role_name != '') {
				// get competitor role as defined in config
				let competitorRole = await guild.roles.find(role => role.name === config.competitor_role_name);
				// ensure competitor role exists
				if (competitorRole != null && competitorRole.id != undefined)
					// check if user has competitor role
					if (!message.member._roles.includes(competitorRole))
						// add competitor role to user
						message.member.addRole(competitorRole);
			}
			// set the user's competing state to true
			var res = await user.setCompeting(true);
			if (res)
				message.channel.send(strings.user_now_competing.replaceAll('{user}', tag(message.author.id)));
			break;
		// quit command, disables competing for the user
		case 'quit':
			// check if user is registered
			if (!user) {
				// not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// check if the user is currently competing
			if (!user.competing) {
				message.channel.send(strings.quit_not_competing.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			var quit = await quitUser(message.member.user.id);
			if (quit)
				message.channel.send(strings.user_no_longer_competing.replaceAll('{user}', tag(message.author.id)));
			break;
		// competing command, shows if user is competing or not
		case 'competing':
			if (args.length == 0) {
				// check if user is registered
				if (!user) {
					// not registered
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// check if user is currently competing
				user.competing ?
					message.channel.send(strings.user_is_competing.replaceAll('{user}', tag(message.author.id))) :
					message.channel.send(strings.user_is_not_competing.replaceAll('{user}', tag(message.author.id)));
				break;
			} else if (args.length == 1) {
				// check for a mention
				var mention = message.mentions.users.values().next().value;
				if (mention == undefined) {
					// no mentions
					message.channel.send(strings.competing_no_user_specified.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// get user's database id
				var user_id = await db.getUserIdFromDiscordId(mention.id);
				if (!user_id) {
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id)));
					break;
				}
				// create user object
				var user = await new User(user_id, db, client).init();
				if (!user) {
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id)));
					break;
				}
				// check if the user is currently competing
				user.competing ?
					message.channel.send(strings.target_is_competing.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id))) :
					message.channel.send(strings.target_is_not_competing.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', await getDiscordUsernameFromDiscordId(mention.id)));
			}
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
		// old sr command, shows rank and skill rating (deprecated). Useful for debug
		case 'sr2':
			if (args.length == 0) {
				// gets user skill rating
				// check if user is registered
				if (!user) {
					// user is not registered
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// output user skill rating
				message.channel.send(strings.user_skill_rating.replaceAll('{user}', tag(message.author.id)).replaceAll('{elo_rating}', user.elo_rating).replaceAll('{elo_rank}', user.elo_rank));
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
				// get target
				var target = await new User(target_id, db, client).init();
				if (!target) {
					// failed to get target user
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					break;
				}
				// output target skill rating
				message.channel.send(strings.target_skill_rating.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username).replaceAll('{elo_rating}', target.elo_rating).replaceAll('{elo_rank}', target.elo_rank));
			}
			break;
		// elo command, shows user rank and elo, plus 2 users above rank and 2 users below rank
		case 'elo':
			// TODO: add !elo <player>
			// check if user is registered
			if (!user) {
				// user is not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// check if user is competing
			if (!user.competing) {
				// user is not competing
				message.channel.send(strings.error_user_not_competing.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// check if user has played enough provisional matches to show elo
			var numMatches = await db.getUserNumConfirmedMatches(user.id);
			if (!numMatches || numMatches < config.provisional_matches) {
				if (!numMatches)
					numMatches = 0;
				message.channel.send(strings.not_enough_provisional_matches_played.replaceAll('{user}', tag(message.author.id)).replaceAll('{num_games_played}', numMatches).replaceAll('{provisional_matches}', config.provisional_matches));
				break;
			}

			// get all competing players in order of rank
			var top = [];
			var players = await db.getTopCompetingPlayers(-1);
			for (var i in players) {
				var numMatches = await db.getUserNumConfirmedMatches(players[i].id);
				if (numMatches && numMatches >= config.provisional_matches)
					top.push(players[i]);
			}

			// find the user in the player list
			var player_index = 0;
			for (i = 0; i < top.length; i++)
				if (top[i].id == user.id)
					player_index = i;

			// construct message
			var msg = '';
			for (i = player_index - 2; i < player_index + 3; i++) {
				if (i >= top.length || !top[i])
					continue;
				// get player username
				var username = await getDiscordUsernameFromDiscordId(top[i].discord_id);
				// list top players
				if (top[i].id == user.id)
					username = tag(top[i].discord_id);
				msg += `${i + 1}. ${username}: ${top[i].elo_rating} ELO\n`;
			}
			message.channel.send(msg);
			break;
		// confirm command, shows pending match submissions
		case 'confirm':
			if (args.length == 0) {
				// show pending match submissions vs the user
				// check if user is registered
				if (!user) {
					// not registered
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// get user's recent matches
				var latest_matches = await db.getUserUnconfirmedMatches(user.id);
				if (!latest_matches) {
					// no recent unconfirmed matches
					message.channel.send(strings.no_unconfirmed_matches.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', message.author.username));
					break;
				}
				// waiting_for_input will be true if there is one or more match which the user should confirm with reaction emojis
				var waiting_for_input = false;
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
					// get opponent username
					var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
					// compose message with match id, tag the author, show other player's name in plaintext (no tag)
					var text = '';
					submitter_was_user ? text += strings.pending_submitter_was_user : text += strings.pending_submitter_was_not_user;
					// send it
					var reactionMessage = await message.channel.send(text
						.replaceAll('{user}', tag(message.author.id))
						.replaceAll('{opponent_name}', opponent_username)
						.replaceAll('{match_id}', match.id)
						.replaceAll('{winloss}', match_result_string)
					);
					// if the submitter was the user, no emojis necessary.
					if (submitter_was_user)
						continue;
					// ask the user to thumb up/down whether they won or not after looping through all unconfirmed matches
					waiting_for_input = true;

					// get match
					var match = await db.getMatch(match.id);
					if (!match)
						throw (`Could not getMatch(${match.id})`);
					// return if the match is already confirmed, for whatever reason
					if (match.confirmed)
						return;
					// get opponent data
					var opponent_data = await db.getUserDataUsingId(match.player_id);
					if (!opponent_data)
						throw (`Could not getUserDataUsingId(${match.player_id})`);
					onThumbsUp = async (match) => {
						// the match was confirmed
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
						var newPlayerElo = eloCalculation.new_player_elo;
						var newOpponentElo = eloCalculation.new_opponent_elo;
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
						// get player username
						var player_username = await getDiscordUsernameFromDiscordId(player_data.discord_id);
						// get opponent username
						var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
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
							.replaceAll('{player_name}', player_username)
							.replaceAll('{opponent_name}', opponent_username)
							.replaceAll('{player_elo_rank}', player_rank)
							.replaceAll('{opponent_elo_rank}', opponent_rank)
							.replaceAll('{old_player_elo}', playerElo)
							.replaceAll('{new_player_elo}', newPlayerElo)
							.replaceAll('{old_opponent_elo}', opponentElo)
							.replaceAll('{new_opponent_elo}', newOpponentElo));
					}
					onThumbsDown = async (match) => {
						// the match was disputed
						await message.channel.send(strings.pending_dispute
							.replaceAll('{user}', tag(message.author.id))
							.replaceAll('{opponent}', tag(opponent_data.discord_id))
							.replaceAll('{match_id}', match.id)
							.replaceAll('{admin}', tagRole(guild.roles.find(role => role.name === config.admin_role_name).id))
						);
					}
					onCancel = async (cancelMsg = null) => {
						if (cancelMsg)
							await message.channel.send(`${tag(message.author.id)} Cancelled: ${cancelMsg}`);
						else
							await message.channel.send(`${tag(message.author.id)} Cancelled.`);
					}
					await listenForReaction(message, reactionMessage, onThumbsUp, onThumbsDown, onCancel, match);
				}
				// a match has confirm and dispute emojis waiting for input
				if (waiting_for_input)
					message.channel.send(strings.pending_waiting_for_input.replaceAll('{user}', tag(message.author.id)));
			}
			break;
		// submit command, submits a match result vs another user
		case 'submit':
			// ensure the user is registered
			if (!user) {
				// user not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// check for a mention
			var mention = message.mentions.users.values().next().value;
			if (args.length != 1 || !mention || mention.id == message.author.id) {
				// no mentions, too many arguments, or user mentioned self
				message.channel.send(strings.submit_no_user_specified.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// get mention's database id
			var mentionId = await db.getUserIdFromDiscordId(mention.id);
			if (!mentionId) {
				// mention is not registered
				message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
				break;
			}
			// get mention data
			var target = await new User(mentionId, db, client).init();
			// check if mention is competing
			if (!target.competing) {
				// mention is not competing
				message.channel.send(strings.target_is_not_competing.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
				break;
			}
			// get the user's latest matches of the week
			var user_matches = await db.getUserRecentMatches(user.id, 0);
			// check if user has played the maximum amount of games this week as defined in the config
			if (user_matches)
				if (user_matches.length >= config.maximum_weekly_challenges) {
					// user has already played the maximum amount of matches for the week
					message.channel.send(strings.max_weekly_matches_played.replaceAll('{user}', tag(message.author.id)).replaceAll('{maximum_weekly_challenges}', config.maximum_weekly_challenges));
					break;
				}
			// get the mention's latest matches of the week
			var target_latest_matches = await db.getUserRecentMatches(target.id, 0);
			// check if target has played the maximum amount of games this week as defined in the config
			if (target_latest_matches)
				if (target_latest_matches.length >= config.maximum_weekly_challenges) {
					// mention has already played the maximum amount of matches for the week
					message.channel.send(strings.max_weekly_matches_played_other.replaceAll('{mention_name}', mention.username).replaceAll('{maximum_weekly_challenges}', config.maximum_weekly_challenges));
					break;
				}
			// ask the user if they won
			var msg = await message.channel.send(strings.did_you_win.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
			// get player's elo rating
			var playerElo = user.elo_rating;
			// get opponent's elo rating
			var opponentElo = target.elo_rating;
			onThumbsUp = async () => {
				// submit match result
				await db.submitMatchResult(user.id, target.id, true, playerElo, opponentElo, null, null);
				// ask the target user to confirm the game
				message.channel.send(strings.confirm_game_please.replaceAll('{target}', tag(mention.id)).replaceAll('{user}', message.author.username).replaceAll('{match_id}'));
			}
			onThumbsDown = async () => {
				// submit match result
				await db.submitMatchResult(user.id, target.id, false, playerElo, opponentElo, null, null);
				// ask the target user to confirm the game
				message.channel.send(strings.confirm_game_please.replaceAll('{target}', tag(mention.id)).replaceAll('{user}', message.author.username).replaceAll('{match_id}'));
			}
			onCancel = async (cancelMsg = null) => {
				if (cancelMsg) {
					// no y/n reaction was collected
					message.channel.send(strings.match_submit_timeout.replaceAll('{user}', tag(message.author.id)));
				} else {
					// submission cancelled by user
					message.channel.send(strings.match_submit_cancel.replaceAll('{user}', tag(message.author.id)));
				}
			}
			await listenForReaction(message, msg, onThumbsUp, onThumbsDown, onCancel);
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
					break;
				}
				// get target user id from target discord id, checking if the target is registered
				var target_id = await db.getUserIdFromDiscordId(mention.id);
				if (!target_id) {
					// could not get target user id from discord id
					message.channel.send(strings.error_target_not_registered.replaceAll('{user}', tag(message.author.id)).replaceAll('{target}', mention.username));
					break;
				}
				// ensure the user is registered
				if (!user) {
					// not registered
					message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
					break;
				}
				// get all of the target's matches
				var user_matches = await db.getAllUserMatches(target_id);
				if (!user_matches) {
					// no matches found
					message.channel.send(strings.matches_no_recent_matches.replaceAll('{user}', tag(message.author.id)));
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
				var str = strings.matches_dialogue_other
					.replaceAll('{user}', tag(message.author.id))
					.replaceAll('{target}', mention.username)
					.replaceAll('{num_matches}', confirmed_matches.length + unconfirmed_matches.length)
					.replaceAll('{num_max_matches}', config.maximum_weekly_challenges);
				if (unconfirmed_matches.length > 0) {
					str += strings.matches_unconfirmed;
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
						// get player username
						var player_username = await getDiscordUsernameFromDiscordId(player_data.discord_id);
						// get opponent username
						var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
						// construct match result message
						text = '';
						submitter_was_user ?
							text += strings.matches_submitter_was_user :
							text += strings.matches_submitter_was_not_user;
						str += text
							.replaceAll('{player_name}', player_username)
							.replaceAll('{opponent_name}', opponent_username)
							.replaceAll('{match_id}', match.id)
							.replaceAll('{winloss}', match_result_string);
					}
				}
				if (confirmed_matches.length > 0) {
					str += strings.matches_confirmed;
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
						// get player username
						var player_username = await getDiscordUsernameFromDiscordId(player_data.discord_id);
						// get opponent username
						var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
						// construct match result message
						text = '';
						submitter_was_user ?
							text += strings.matches_submitter_was_user :
							text += strings.matches_submitter_was_not_user;
						str += text
							.replaceAll('{player_name}', player_username)
							.replaceAll('{opponent_name}', opponent_username)
							.replaceAll('{match_id}', match.id)
							.replaceAll('{winloss}', match_result_string);
					}
				}
				message.channel.send(str);
				break;
			}
			// ensure the user is registered
			if (!user) {
				// not registered
				message.channel.send(strings.error_not_registered.replaceAll('{user}', tag(message.author.id)));
				break;
			}
			// get the user's matches
			var user_matches = await db.getAllUserMatches(user.id);
			if (!user_matches) {
				message.channel.send(strings.matches_no_recent_matches.replaceAll('{user}', tag(message.author.id)));
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
			var str = strings.matches_dialogue
				.replaceAll('{user}', tag(message.author.id))
				.replaceAll('{num_matches}', confirmed_matches.length + unconfirmed_matches.length)
				.replaceAll('{num_max_matches}', config.maximum_weekly_challenges);
			if (unconfirmed_matches.length > 0) {
				str += strings.matches_unconfirmed;
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
					// get opponent username
					var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
					// construct match result message
					text = '';
					submitter_was_user ?
						text += strings.matches_submitter_was_user :
						text += strings.matches_submitter_was_not_user;
					str += text
						.replaceAll('{player_name}', tag(message.author.id))
						.replaceAll('{opponent_name}', opponent_username)
						.replaceAll('{match_id}', match.id)
						.replaceAll('{winloss}', match_result_string);
				}
			}
			if (confirmed_matches.length > 0) {
				str += strings.matches_confirmed;
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
					// get opponent username
					var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
					// construct match result message
					text = '';
					submitter_was_user ?
						text += strings.matches_submitter_was_user :
						text += strings.matches_submitter_was_not_user;
					str += text
						.replaceAll('{player_name}', tag(message.author.id))
						.replaceAll('{opponent_name}', opponent_username)
						.replaceAll('{match_id}', match.id)
						.replaceAll('{winloss}', match_result_string);
				}
			}
			message.channel.send(str);
			break;
		// admin command, allows showing/updating/deleting match information
		// matchinfo command, allows admins to see match information with match id
		case 'admin':
			// require admin
			if (!admin) break;
			if (args.length > 0) {
				// channels command, shows channels being used by bot
				if (args[0].toLowerCase() == 'channels' && args.length == 1) {
					// list channels
					var msg = '';
					for (i = 0; i < botChannels.length; i++)
						msg += `${client.channels.get(botChannels[i].channel_id)}:${botChannels[i].type}\n`;
					message.channel.send(strings.channels_list.replaceAll('{user}', tag(message.author.id)).replaceAll('{channels}', msg));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// init command, to initialize a channel for use by the bot
				if (args[0].toLowerCase() == 'init' && args.length == 2) {
					// loop through channels, check if current channel is already added
					for (var c in botChannels) {
						if (botChannels[c].channel_id.toString() === message.channel.id.toString()) {
							// already using channel
							message.channel.send(strings.init_already_using_channel.replaceAll('{user}', tag(message.author.id)).replaceAll('{channel_id}', message.channel.id).replaceAll('{channel_name}', message.channel.name));
							// remove command message from pending user responses
							user_commands_running.delete(message.id);
							return;
						}
					}
					// add current channel to channels list
					await db.createChannel(message.channel.id, args[1]);
					// create teams table for channel
					await db.createTeamTable(args[1]);
					// create team membership table for channel
					await db.createTeamMembershipTable(args[1]);
					// create matches table for channel
					await db.createMatchesTable(args[1]);
					// create invites table for channel
					await db.createInvitesTable(args[1]);
					// success, list channels
					botChannels = await db.getChannels();
					var msg = '';
					for (i = 0; i < botChannels.length; i++)
						msg += `${client.channels.get(botChannels[i].channel_id)}:${botChannels[i].type}\n`;
					message.channel.send(strings.init_success.replaceAll('{user}', tag(message.author.id)).replaceAll('{channels}', msg));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// deinit command, makes the bot stop using a channel
				if (args[0].toLowerCase() == 'deinit' && args.length == 1) {
					// check if channel is being used currently
					var channelInUse = false;
					for (var c in botChannels)
						if (botChannels[c].channel_id.toString() === message.channel.id.toString())
							channelInUse = true;
					if (!channelInUse) {
						message.channel.send(strings.deinit_not_using_channel.replaceAll('{user}', tag(message.author.id)).replaceAll('{channel_id}', message.channel.id).replaceAll('{channel_name}', message.channel.name));
						break;
					}
					// stop using this channel
					await db.removeChannel(message.channel.id);
					// refresh the channels list
					botChannels = await db.getChannels();
					// list channels
					var msg = '';
					for (i = 0; i < botChannels.length; i++)
						msg += `${client.channels.get(botChannels[i].channel_id)}:${botChannels[i].type}\n`;
					message.channel.send(strings.init_success.replaceAll('{user}', tag(message.author.id)).replaceAll('{channels}', msg));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// show average elo
				if ((args[0].toLowerCase() == 'average' || args[0].toLowerCase() == 'avg') && args.length == 1) {
					var avg = await db.getAverageElo();
					var compAvg = await db.getAverageCompetingElo();
					message.channel.send(`Average ELO: ${avg}\nAverage competing ELO: ${compAvg}`);
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// run matchup suggestion function, which will save the matchups in the database but not tag users
				if (args[0].toLowerCase() == 'generatematchups' && args.length == 1) {
					suggestMatchups(message.channel, true, true);
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// info command, shows match info
				if (args[0].toLowerCase() == 'info' && args.length == 2) {
					// get match
					var match = await db.getMatch(args[1]);
					if (!match) {
						message.channel.send(strings.match_not_found.replaceAll('{match_id}', args[1]));
						break;
					}
					var msg = '';
					for (var e in match)
						msg += `${e}: ${match[e]}\n`;
					message.channel.send(`\`\`\`${msg}\`\`\``);
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// admin confirm command, confirms a pending match
				if (args[0].toLowerCase() == 'confirm' && args.length == 2) {
					// get match
					var match = await db.getMatch(args[1]);
					if (!match) {
						message.channel.send(strings.match_not_found.replaceAll('{match_id}', args[1]));
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
					// get player username
					var player_username = await getDiscordUsernameFromDiscordId(player_data.discord_id);
					// get opponent username
					var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
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
						.replaceAll('{player_name}', player_username)
						.replaceAll('{opponent_name}', opponent_username)
						.replaceAll('{player_elo_rank}', player_rank)
						.replaceAll('{opponent_elo_rank}', opponent_rank)
						.replaceAll('{old_player_elo}', playerElo)
						.replaceAll('{new_player_elo}', eloCalculation.new_player_elo)
						.replaceAll('{old_opponent_elo}', opponentElo)
						.replaceAll('{new_opponent_elo}', eloCalculation.new_opponent_elo));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// cancel command, allows admins to cancel a pending match with match id
				if (args[0].toLowerCase() == 'cancel' && args.length == 2) {
					// get match
					var match = await db.getMatch(args[1]);
					if (!match) {
						message.channel.send(strings.match_not_found.replaceAll('{match_id}', args[1]));
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
					// get player username
					var player_username = await getDiscordUsernameFromDiscordId(player_data.discord_id);
					// get opponent username
					var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
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
						.replaceAll('{player_name}', player_username)
						.replaceAll('{opponent_name}', opponent_username)
						.replaceAll('{player_elo_rank}', player_rank)
						.replaceAll('{opponent_elo_rank}', opponent_rank)
						.replaceAll('{old_player_elo}', playerElo)
						.replaceAll('{new_player_elo}', newPlayerElo)
						.replaceAll('{old_opponent_elo}', opponentElo)
						.replaceAll('{new_opponent_elo}', newOpponentElo));
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// nullify command, deletes a game result
				if (args[0].toLowerCase() == 'nullify' && args.length == 2) {
					// get match
					var match = await db.getMatch(args[1]);
					if (!match) {
						message.channel.send(strings.match_not_found.replaceAll('{match_id}', args[1]));
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
						// get player username
						var player_username = await getDiscordUsernameFromDiscordId(player_data.discord_id);
						// get opponent username
						var opponent_username = await getDiscordUsernameFromDiscordId(opponent_data.discord_id);
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
							.replaceAll('{player_name}', player_username)
							.replaceAll('{opponent_name}', opponent_username)
							.replaceAll('{player_elo_rank}', player_rank)
							.replaceAll('{opponent_elo_rank}', opponent_rank)
							.replaceAll('{old_player_elo}', playerElo)
							.replaceAll('{new_player_elo}', newPlayerElo)
							.replaceAll('{old_opponent_elo}', opponentElo)
							.replaceAll('{new_opponent_elo}', newOpponentElo));
					}
					await db.deleteMatch(match.id);
					await message.channel.send(`${tag(message.author.id)} deleted match ${match.id}.`);
					// remove command message from pending user responses
					user_commands_running.delete(message.id);
					return;
				}
				// say command, make the bot say a message
				if (args[0].toLowerCase() == 'say' && args.length > 2) {
					// ensure the message has a channel tagged
					if (message.mentions.channels.size > 0) {
						// construct message
						var str = '';
						for (var i = 2; i < args.length; i++)
							str += args[i] + ' ';
						// send the message to the tagged channel
						message.mentions.channels.values().next().value.send(str.trim());
						// remove command message from pending user responses
						user_commands_running.delete(message.id);
						return;
					}
				}
				// warn command, warn inactive users that they will be quit next week
				if (args[0].toLowerCase() == 'warn' && args.length == 2) {
					if (message.mentions.channels.size > 0) {
						// warn users that they will be auto-quit after n weeks of inactivity
						var quit = [];
						var competing = await db.getTopCompetingPlayers(-1);
						for (var i = 1; i < competing.length; i++) {
							var matches = await db.getUserRecentMatches(competing[i].id, config.auto_quit_weeks - 1);
							if (!matches) {
								quit.push(competing[i].discord_id);
							}
						}
						var msg = strings.auto_quit_warning_message.replaceAll('{weeks}', config.auto_quit_weeks) + '\n';
						for (var i = 0; i < quit.length; i++) {
							msg += `${tag(quit[i])}`;
							if (i != quit.length - 1)
								msg += `, `;
						}
						message.mentions.channels.values().next().value.send(msg);
						// remove command message from pending user responses
						user_commands_running.delete(message.id);
						return;
					}
				}
			}
			msg = `${tag(message.author.id)}\n${strings.admin_help}`;
			message.channel.send(msg.replaceAll('{user}', tag(message.author.id)));
			break;
	}
	// remove command message from pending user responses
	user_commands_running.delete(message.id);
});

client.on('disconnect', () => {
	log.info('Discord bot is disconnecting.');
});

client.on('resume', () => {
	log.info('Discord bot is resuming.');
});

client.on('reconnecting', () => {
	log.info('Discord bot is reconnecting.');
});

/**
 * @description Returns a string which will tag the user if put in a discord message.
 * @param {string} userID the user to tag's user ID
 * @return {string} '<@userID>'
 */
function tag(userID) {
	return `<@${userID}>`;
}

/**
 * @description Returns a string which will tag the role if put in a discord message.
 * @param {string} roleID the role's ID
 * @return {string} '<@roleID>'
 */
function tagRole(roleID) {
	return `<@&${roleID}>`;
}

/**
 * @description Get the team role for the specified team name
 * @param {string} teamName
 * @return {role} the teams' role
 */
async function getTeamRole(teamName) {
	return await guild.roles.find(role => role.name === teamName);
}

/**
 * 
 * @param {int} playerElo the player's current elo
 * @param {int} opponentElo the opponent's current elo
 * @param {boolean} result game win/loss
 * @return elo rating calculation
 */
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


/**
 * @description gets the previous Monday of a specified date
 * @param {Date} d the date to get the previous Monday of
 * @return {Date} the date of the previous Monday
 */
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

// decays elo of players who haven't played a match in the previous week
async function decayInactiveElo(amount) {
	var decayed = [];
	var toDecay = await db.getUsersToDecayElo();
	for (var u in toDecay) {
		let user = toDecay[u];
		let newElo = user.elo_rating - amount;
		// set decayed user elo
		await db.setUserEloRating(user.id, newElo);
		// get player username
		var player_username = await getDiscordUsernameFromDiscordId(user.discord_id);
		decayed.push({
			id: user.id,
			discord_id: user.discord_id,
			discord_username: player_username,
			old_elo: user.elo_rating,
			new_elo: newElo
		});
	}
	return decayed;
}

// gets discord username using discord id
async function getDiscordUsernameFromDiscordId(discord_id) {
	// ensure discord id is in string form
	discord_id = discord_id.toString();
	try {
		// fetch the member in the guild. This will throw an error if the member is not in the guild.
		let m = await guild.fetchMember(discord_id);
		// return the player's username
		if (m != undefined && m.nickname != null)
			return m.nickname;
		// member is not in guild, fetch their username instead
		var user = await client.fetchUser(discord_id);
		return user.username;
	} catch {
		// member is not in guild, fetch their username instead
		var user = await client.fetchUser(discord_id);
		return user.username;
	}
}

// suggests weekly matchups
async function suggestMatchups(channel, tagUsers, save) {
	// array to store players in if we are saving this player list
	var saveList = [];
	// compose matchups message
	var msg = strings.suggested_matchups_message;
	// loop through all competing players
	var players = await db.getTopCompetingPlayers(-1);
	// leave out the odd player out
	if (config.suggested_matchups_odd_player != 0 && players.length % 2 != 0)
		for (var p in players)
			if (players[p].discord_id == config.suggested_matchups_odd_player_out)
				players.splice(p, 1);
	// loop through competing players 2 at a time
	for (var i = 0; i < players.length; i += 2) {
		var p1 = players[i];
		var p2 = players[i + 1];
		// ensure the players aren't null
		if (p1 != null && p2 != null) {
			if (tagUsers)
				msg += strings.suggested_matchups_playerlist_tag.replaceAll('{player1}', tag(p1.discord_id)).replaceAll('{player2}', tag(p2.discord_id));
			else
				msg += strings.suggested_matchups_playerlist.replaceAll('{player1}', await getDiscordUsernameFromDiscordId(p1.discord_id)).replaceAll('{player2}', await getDiscordUsernameFromDiscordId(p2.discord_id));
			// add the players to the save list
			if (save) {
				saveList.push({ id: p1.id, discord_id: p1.discord_id });
				saveList.push({ id: p2.id, discord_id: p2.discord_id });
			}
		}
	}
	if (save)
		await db.saveWeeklyMatchups(saveList);
	channel.send(msg);
	return;
}

// quit a user
async function quitUser(discord_id) {
	// get database id from discord id
	var user_id = await db.getUserIdFromDiscordId(discord_id);
	// create user object
	var user = await new User(user_id, db, client).init();
	if (!user) return;
	// check if the user is currently competing
	if (!user.competing) return;
	// get average elo
	var averageElo = await db.getAverageCompetingElo();
	// set the user's elo to average if above average
	if (user.elo_rating > averageElo)
		await db.setUserEloRating(user.id, averageElo);
	// check if competitor role is defined in config
	if (config.competitor_role_name != null && config.competitor_role_name != '') {
		// get competitor role as defined in config
		let competitorRole = await guild.roles.find(role => role.name === config.competitor_role_name);
		// ensure competitor role exists
		if (competitorRole != null && competitorRole.id != undefined) {
			// get member
			var member = await guild.members.find(member => member.id.toString() === discord_id.toString());
			if (member != null) {
				// check if user has competitor role
				if (!member._roles.includes(competitorRole))
					// add competitor role to user
					member.removeRole(competitorRole);
			}
		}
	}
	// get challengeme role
	let challengemeRole = await guild.roles.find(role => role.name === 'challengeme');
	// ensure challengeme role exists
	if (challengemeRole != null && challengemeRole.id != undefined) {
		// get member
		var member = await guild.members.find(member => member.id.toString() === discord_id.toString());
		if (member != null) {
			// check if user has challengeme role
			if (!member._roles.includes(challengemeRole))
				// add challengeme role to user
				member.removeRole(challengemeRole);
		}
	}
	// set the user's competing state to false
	return await user.setCompeting(false);
}

// get a random color
function getRandomColor() {
	var letters = '0123456789ABCDEF';
	var color = '#';
	for (var i = 0; i < 6; i++) {
		color += letters[Math.floor(Math.random() * 16)];
	}
	return color;
}

async function listenForReaction(message, msg, onThumbsUp, onThumbsDown, onCancel, data) {
	// ensure only one response from the user per message by storing message ids in collected array
	var collected = [];
	// ensure one instance of the command
	user_commands_running.set(msg.id, message.author.id);
	// await y/n/cancel reaction from user for 60 seconds
	var filter = (reaction, usr) => (reaction.emoji.name === ReactionEmoji.THUMBS_UP || reaction.emoji.name === ReactionEmoji.THUMBS_DOWN || reaction.emoji.name === ReactionEmoji.CANCEL) && usr.id === message.author.id;
	var collector = await msg.createReactionCollector(filter, { time: 60000 });
	collector.on('collect', async (r) => {
		// already got a response from the user for this message
		if (collected.includes(r.message.id))
			return;
		// prevent the user from reacting to the same message again
		await collected.push(r.message.id);
		// confirm or dispute?
		if (r._emoji.name === ReactionEmoji.THUMBS_UP) {
			await msg.react(ReactionEmoji.CONFIRMED);
			await onThumbsUp(data);
		} else if (r._emoji.name === ReactionEmoji.THUMBS_DOWN) {
			await msg.react(ReactionEmoji.CONFIRMED);
			await onThumbsDown(data);
		} else if (r._emoji.name === ReactionEmoji.CANCEL) {
			await msg.react(ReactionEmoji.CANCELLED);
			await onCancel();
		}
		// remove reaction message from pending user responses
		user_commands_running.delete(r.message.id);
	});
	collector.on('end', async () => {
		// collector ends when the filter time is up
		// loop through all collectors
		for (var c in collectors) {
			// if this collector's message id is a key in the map of users running commands, and the value is the author's discord id
			if (user_commands_running.get(collectors[c].message.id) == message.author.id) {
				// timed out, cancel
				await collectors[c].message.react(ReactionEmoji.CANCELLED);
				await onCancel(`Timed out.`);
				// remove reaction message from pending user responses
				user_commands_running.delete(collectors[c].message.id);
			}
		}
	});
	// add submission reactions to msg
	await msg.react(ReactionEmoji.THUMBS_UP);
	await msg.react(ReactionEmoji.THUMBS_DOWN);
	await msg.react(ReactionEmoji.CANCEL);
	// add the reaction collector to the a array of collectors
	await collectors.push(collector);
}
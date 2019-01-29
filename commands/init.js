module.exports.command = async (message) => {
	// loop through channels, check if current channel is already added
	var channels = discord_channels_to_use;
	if (channels != undefined) {
		if (channels.includes(message.channel.id)) {
			message.channel.send(strings.init_already_using_channel.replaceAll('{user}', tag(message.author.id)).replaceAll('{channel_id}', message.channel.id).replaceAll('{channel_name}', message.channel.name));
			return;
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
	for (i = 0; i < discord_channels_to_use.length; i++) {
		msg += `${discord_channels_to_use[i]}:${client.channels.get(discord_channels_to_use[i])}\n`;
	}
	message.channel.send(msg.replaceAll('{user}', tag(message.author.id)).replaceAll('{channels}', msg));
	return;
}
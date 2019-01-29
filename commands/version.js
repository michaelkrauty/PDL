module.exports.command = async (message, client, package) => {
	message.channel.send(`${client.user.username} v${package.version}`);
}
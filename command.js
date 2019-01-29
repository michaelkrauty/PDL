const VersionCommand = require('./commands/version.js');
const InitCommand = require('./commands/init.js');

exports.Command = class {
	constructor(client, db, pkg, message, admin, discord_channels_to_use) {
		this.client = client;
		this.message = message;
		this.db = db;
		this.package = pkg;
		this.admin = admin;
		this.discord_channels_to_use = discord_channels_to_use;
	}

	versionCommand() {
		return VersionCommand.command(this.message, this.client, this.package);
	}

	initCommand() {
		return InitCommand.command(this.message);
	}
}
exports.User = class {
	constructor(id, db, client) {
		this.id = id;
		this.db = db;
		this.client = client;
	}

	async init() {
		var data = await this.db.getUserDataUsingId(this.id);
		if (!data)
			return false;
		this.discord_id = data.discord_id;
		var usr = await this.client.fetchUser(this.discord_id);
		this.discord_username = usr.username;
		this.elo_rating = data.elo_rating;
		this.elo_rank = await this.db.getUserEloRanking(this.id);
		this.competing = data.competing;
		return this;
	}

	getID() {
		return this.id;
	}

	getDiscordID() {
		return this.discord_id;
	}

	getDiscordUsername() {
		return this.discord_username;
	}

	getEloRating() {
		return this.elo_rating;
	}

	getEloRank() {
		return this.elo_rank;
	}

	getCompeting() {
		return this.competing;
	}

	async setCompeting(competing) {
		this.competing = competing;
		return await this.db.setUserCompeting(this.discord_id, competing);
	}

	async setDiscordUsername(username) {
		this.discord_username = username;
		return await this.db.setUserDiscordUsername(this.id, username);
	}
}

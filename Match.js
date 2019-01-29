exports.Match = class {
	constructor(id, db) {
		this.id = id;
		this.db = db;
	}

	async init() {
		var data = await this.db.getMatch(this.id);
		if (!data)
			return false;
		this.player_id = data.player_id;
		this.opponent_id = data.opponent_id;
		this.result = data.result;
		this.confirmed = data.confirmed;
		this.player_start_elo = data.player_start_elo;
		this.player_end_elo = data.player_end_elo;
		this.opponent_start_elo = data.opponent_start_elo;
		this.opponent_end_elo = data.opponent_end_elo;
		this.timestamp = data.timestamp;
		return this;
	}
}
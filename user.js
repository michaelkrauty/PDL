exports.User = class {
	constructor(id) {
		this.id = id;
		this.db = require('./DB.js');
	}

	getElo() {
		return this.db.getUserEloRating(this.id);
	}
}
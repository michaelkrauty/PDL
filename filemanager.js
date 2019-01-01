const fs = require('fs');
exports.checkFile = function (filename) {
	return new Promise(async function (resolve, reject) {
		await fs.exists(filename, async function (exists) {
			if (!exists)
				await fs.writeFileSync(filename, JSON.stringify({ data: [] }), (err) => {
					log.error(err);
				});
			resolve(exists);
		});
	});
}
exports.writeFile = function (filename, data) {
	return new Promise(async function (resolve, reject) {
		await exports.checkFile(filename);
		fs.writeFileSync(filename, data);
		resolve();
	})
}
const API = require('../../utils/api');
const auth = require('../../utils/auth');

exports.insert = class extends API {

	//POST
	async insert() {

		this.user.privilege.needs("dashboard");

		const mandatoryData = ["dashboard_id", "user_id"];

		mandatoryData.map(x => this.assert(this.request.body[x], x + " is missing"));

		const authResponse = auth.dashboard(this.request.body.dashboard_id, this.user);

		this.assert(!authResponse.error, authResponse.message);

		return await this.mysql.query(
			"INSERT IGNORE INTO tb_user_dashboard (user_id, dashboard_id) VALUES (?, ?)",
			[this.request.body.user_id, this.request.body.dashboard_id],
			"write"
		);
	}
};


exports.delete = class extends API {

	//POST
	async delete() {

		this.user.privilege.needs("dashboard");

		const mandatoryData = ["dashboard_id", "user_id"];

		mandatoryData.map(x => this.assert(this.request.body[x], x + " is missing"));

		const authResponse = auth.dashboard(this.request.body.dashboard_id, this.user);

		this.assert(!authResponse.error, authResponse.message);

		return await this.mysql.query(
			"DELETE FROM tb_user_dashboard  WHERE user_id = ? and dashboard_id = ?",
			[this.request.body.user_id, this.request.body.dashboard_id],
			"write"
		);
	}
};


exports.update = class extends API {

	async update() {

		this.user.privilege.needs('dashboard');

		const
			values = {},
			columns = ['dashboard_id', 'user_id',];

		for(const key in this.request.body) {

				if (columns.includes(key)) {

					values[key] = this.request.body[key] || null;
			}
		}

		const authResponse = auth.dashboard(this.request.body.dashboard_id, this.user);

		this.assert(!authResponse.error, authResponse.message);

		return await this.mysql.query(
			'UPDATE tb_user_dashboard SET ? WHERE id = ? and (select account_id from tb_dashboards where id = ?) = ?',
			[values, this.request.body.id, this.request.body.id, this.account.account_id],
			'write'
		);
	}
};


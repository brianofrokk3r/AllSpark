const API = require('../utils/api');
const auth = require('../utils/auth');

//update delete current dashboard dekh ke


exports.list = class extends API {

	async list() {

		let dashboards = this.mysql.query("select * from tb_dashboards where status = 1 and account_id = ?", [this.account.account_id]);

		let sharedDashboards = this.mysql.query(
			"select * from tb_user_dashboard ud join tb_dashboards d on d.id = ud.dashboard_id where d.status = 1 and account_id = ?",
			[this.account.account_id]
		);

		let queryDashboards = this.mysql.query(
			"select * from tb_query_dashboard qd join tb_dashboards d on d.id = qd.dashboard_id where d.status = 1 and account_id = ?",
			[this.account.account_id]
		);

		const dashboardDetails = await Promise.all([dashboards, sharedDashboards, queryDashboards]);

		dashboards = dashboardDetails[0];
		sharedDashboards = dashboardDetails[1];
		queryDashboards = dashboardDetails[2];

		const dashboardObject = {};

		dashboards.map(dashboard => dashboardObject[dashboard.id] = {...dashboard, shared_user: [], queries: []});

		for (const sharedDashboard of sharedDashboards) {

			if (!dashboardObject[sharedDashboard.dashboard_id]) {

				continue;
			}

			dashboardObject[sharedDashboard.dashboard_id].shared_user.push(sharedDashboard);
		}

		for (const queryDashboard of queryDashboards) {

			if (!dashboardObject[queryDashboard.dashboard_id]) {

				continue;
			}

			dashboardObject[queryDashboard.dashboard_id].queries.push(queryDashboard);
		}

		return Object.values(dashboardObject);
	}
};

exports.insert = class extends API {

	async insert() {

		this.user.privilege.needs('dashboard');

		let
			values = {},
			columns = ['name', 'parent', 'icon', 'roles', 'format', 'type'];

		for (const key in this.request.body) {

			if (columns.includes(key)) {

				values[key] = this.request.body[key] || null;
			}
		}

		values.added_by = this.user.user_id;

		values.account_id = this.account.account_id;

		return await this.mysql.query('INSERT INTO tb_dashboards SET ? ', [values], 'write');
	}
};

exports.delete = class extends API {

	async delete() {

		this.user.privilege.needs('dashboard');

		const mandatoryData = ["dashboard_id", "user_id"];

		mandatoryData.map(x => this.assert(this.request.body[x], x + " is missing"));

		const authResponse = auth.dashboard(this.request.body.dashboard_id, this.user);

		this.assert(!authResponse.error, authResponse.message);

		return await this.mysql.query(
			'UPDATE tb_dashboards SET status = 0 WHERE id = ? AND account_id = ?',
			[this.request.body.id, this.account.account_id],
			'write'
		);
	}
};


exports.update = class extends API {

	async update() {

		this.user.privilege.needs('dashboard');

		const
			values = {},
			columns = ['name', 'parent', 'icon', 'roles', 'type', 'visibility'];

		for (const key in this.request.body) {

			if (columns.includes(key)) {

				values[key] = this.request.body[key] || null;
			}
		}

		const authResponse = auth.dashboard(this.request.body.dashboard_id, this.user);

		this.assert(!authResponse.error, authResponse.message);

		return await this.mysql.query(
			'UPDATE tb_dashboards SET ? WHERE id = ? AND account_id = ?',
			[values, this.request.body.id, this.account.account_id],
			'write'
		);
	}
};
const API = require('../../utils/api');
const commFunc = require('../commonFunctions');

class User extends API {

	async view() {

		return await this.mysql.query(`
			SELECT
				user_id,
				account_id,
				CONCAT(first_name,' ',last_name) as name, 
				phone,
				email,
				privileges
			FROM
				tb_users
			WHERE
				user_id = ?
				AND account_id = ?
		`, [this.request.query.user_id, this.account.account_id], 'allSparkRead');
	}

	async changePassword() {

		const abc = await this.mysql.query(`select password from tb_users where user_id = ? and account_id = ?`, [this.request.body.user_id, this.account.account_id], 'allSparkRead');
		const check = await commFunc.verifyBcryptHash(this.request.body.oldPass, abc[0].password);
		if(check) {
			const newPass = await commFunc.makeBcryptHash(this.request.body.newPass);
			return await this.mysql.query(`UPDATE tb_users SET password = ? where user_id = ? and account_id = ?`, [newPass, this.request.body.user_id, this.account.account_id],'allSparkWrite');
		}
		else
			throw("Password does not match!");

	}

}

exports.view = User;
exports.changePassword = User;
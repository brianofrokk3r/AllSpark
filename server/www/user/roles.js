const API = require('../../utils/api');

exports.list = class extends API {
    async list() {

        return await this.mysql.query('SELECT * FROM tb_user_roles');
    }
}

exports.insert = class extends API {
    async insert() {
        this.user.privilege.needs('user', this.request.body.category_id);

		const user_check = await this.mysql.query(
			`SELECT account_id FROM tb_users WHERE user_id = ? AND account_id = ?`,
			[this.request.body.user_id, this.account.account_id]
		);
		const category_check = await this.mysql.query(
			`SELECT * FROM tb_categories WHERE category_id = ? AND account_id = ?`,
			[this.request.body.category_id, this.account.account_id]
		);
		const role_check = await this.mysql.query(
			`SELECT * FROM tb_roles WHERE role_id = ? AND account_id = ?`,
			[this.request.body.role_id, this.account.account_id]

		if(!user_check.length || !category_check.length || !role_check.length)
			throw 'Unauthorised user';

        const params = {
			user_id: this.request.body.user_id,
			category_id: this.request.body.category_id,
			role_id: this.request.body.role_id
        };

        return await this.mysql.query('INSERT INTO tb_user_roles SET ?', [params], 'write');
    }
}

exports.update = class extends API {
    async update() {
        this.user.privilege.needs('user', this.request.body.category_id);

		const existing_check = await this.mysql.query(`
		    SELECT
			    c.account_id AS cat_acc, r.account_id AS role_acc
			FROM
			    tb_user_roles ur
			JOIN
			    tb_categories c USING(category_id)
			JOIN
			    tb_roles r USING(role_id)
			WHERE
			    id = ?
			    AND c.account_id = ?
			    AND r.account_id = ?
	    `,
			[this.request.body.id, this.account.account_id, this.account.account_id]
		);
		const update_check = await this.mysql.query(`
		    SELECT
		        a.account_id AS cat_acc,
		        b.account_id AS role_acc
		    FROM (
		        SELECT
		            account_id
		        FROM
		            tb_categories
		        WHERE
		            category_id = ?
		            AND account_id = ?
		    ) a
		    JOIN (
                SELECT
                    account_id
                FROM
                    tb_roles
                WHERE
                    role_id = ?
                    AND account_id = ?
            ) b
		    `,
			[this.request.body.category_id, this.account.account_id, this.request.body.role_id, this.account.account_id]
        );

		if(!update_check.length || !existing_check.length)
			throw 'Unauthorised user';

        const params = {
            category_id: this.request.body.category_id,
            role_id: this.request.body.role_id
        };

        return await this.mysql.query(
            'UPDATE tb_user_roles SET ? WHERE id = ?',
            [params, this.request.body.id],
            'write'
        );
    }
}

exports.delete = class extends API {

    async delete() {
        this.user.privilege.needs('user', this.request.body.category_id);

        const delete_check = await this.mysql.query(`
            SELECT
                u.account_id
            FROM
                tb_user_roles ur
            JOIN
                tb_users u USING(user_id)
            WHERE
                id = ?
                AND u.account_id = ? 
            `,
            [this.request.body.id, this.account.account_id]
        );

        if(!delete_check.length)
            throw "Unauthorized User"

        return await this.mysql.query(
            'DELETE FROM tb_user_roles WHERE id = ?',
            [this.request.body.id],
            'write'
        );
    }
}
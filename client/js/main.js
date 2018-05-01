"use strict";

window.addEventListener('DOMContentLoaded', async () => {

	await Page.setup();

	if(!Page.class)
		return;

	window.page = new (Page.class)();
});

class Page {

	static async setup() {

		AJAXLoader.setup();

		await Page.load();

		Page.render();
	}

	static async load() {

		await Account.load();
		await User.load();
		await MetaData.load();

		if(account && account.auth_api) {

			const parameters = new URLSearchParams(window.location.search.slice(1));

			if(parameters.has('access_token') && parameters.get('access_token'))
				localStorage.access_token = parameters.get('access_token');
		}
	}

	static render() {

		if(account) {

			if(account.settings.get('hideHeader')) {
				document.querySelector('body > header').classList.add('hidden');
				return;
			}

			if(account.icon)
				document.getElementById('favicon').href = account.icon;

			if(account.logo)
				document.querySelector('body > header .logo img').src = account.logo;

			document.title = account.name;
		}

		const user_name = document.querySelector('body > header .user-name');

		if(user.id)
			user_name.innerHTML = `<a href="/user/profile/${user.user_id}"><i class="fa fa-user" aria-hidden="true"></i>&nbsp;&nbsp;${user.name}</a>`;

		document.querySelector('body > header .logout').on('click', () => User.logout());

		Page.navList = [
			{url: '/users', name: 'Users', privilege: 'users', icon: 'fas fa-users'},
			{url: '/dashboards', name: 'Dashboards', privilege: 'dashboards', icon: 'fa fa-newspaper'},
			{url: '/reports', name: 'Reports', privilege: 'queries', icon: 'fa fa-database'},
			{url: '/connections', name: 'Connections', privilege: 'datasources', icon: 'fa fa-server'},
			{url: '/settings', name: 'Settings', privilege: 'administrator', icon: 'fas fa-cog'},
		];

		const nav_container = document.querySelector('body > header nav');

		for(const item of Page.navList) {

			if(!window.user || !user.privileges.has(item.privilege))
				continue;

			nav_container.insertAdjacentHTML('beforeend',`
				<a href='${item.url}'>
					<i class="${item.icon}"></i>&nbsp;
					${item.name}
				</a>
			`);
		}

		for(const item of document.querySelectorAll('body > header nav a')) {
			if(window.location.pathname.startsWith(new URL(item.href).pathname)) {
				user_name.classList.remove('selected');
				item.classList.add('selected');
			}
		}

		if(window.location.pathname.includes('/user/profile')) {
			Array.from(document.querySelectorAll('body > header nav a')).map(items => items.classList.remove('selected'));
			user_name.querySelector('a').classList.add('selected');
		}
	}

	constructor() {

		this.container = document.querySelector('main');

		this.account = window.account;
		this.user = window.user;
		this.metadata = window.MetaData;

		this.serviceWorker = new Page.serviceWorker(this);
	}
}

Page.exception = class PageException extends Error {

	constructor(message) {
		super(message);
		this.message = message;
	}
}

Page.serviceWorker = class PageServiceWorker {

	constructor(page) {

		this.page = page;

		this.setup();
	}

	async setup() {

		if(!('serviceWorker' in navigator)) {
			this.status = false;
			return;
		}

		this.worker = await navigator.serviceWorker.register('/service-worker.js');

		if(navigator.serviceWorker.controller)
			navigator.serviceWorker.controller.addEventListener('statechange', e => this.statechange(e));
	}

	statechange(event) {

		if(event.target.state != 'redundant')
			return;

		setTimeout(() => {

			const message = document.createElement('div');

			message.classList.add('warning', 'site-outdated');

			message.innerHTML = `The site has been updated in the background. Please <a href="">reload</a> the page.`;

			message.querySelector('a').on('click', () => window.location.reload());

			this.page.container.parentElement.insertBefore(message, this.page.container);

		}, 1000);
	}
}

class Account {

	static async load() {

		let account = null;

		try {
			account = JSON.parse(localStorage.account);
		} catch(e) {}

		if(!account)
			account = await Account.fetch();

		localStorage.account = JSON.stringify(account);

		return window.account = account ? new Account(account) : null;
	}

	static async fetch() {

		try {

			return await API.call('accounts/get');

		} catch(e) {
			return null;
		}
	}

	constructor(account) {

		for(const key in account)
			this[key] = account[key];

		this.settings = new Map;

		if(account.settings && account.settings[0]) {

			for(const key in account.settings[0].value)
				this.settings.set(key, account.settings[0].value[key]);
		}
	}
}

class User {

	static async load() {

		let user = null;

		try {
			user = JSON.parse(atob(localStorage.token.split('.')[1]));
		} catch(e) {}

		return window.user = new User(user);
	}

	static logout(next) {

		const
			access_token = localStorage.access_token || '',
			parameters = new URLSearchParams();

		localStorage.clear();

		localStorage.access_token = access_token || '';

		if(next)
			parameters.set('continue', window.location.pathname + window.location.search);

		window.location = '/login?'+parameters.toString();
	}

	constructor(user) {

		for(const key in user)
			this[key] = user[key];

		this.id = this.user_id;
		this.privileges = new UserPrivileges(this);
		this.roles = new UserPrivileges(this);
	}
}

class UserPrivileges extends Set {

	constructor(context) {

		super(context.privileges);

		this.context = context;
	}

	has(name) {
		return Array.from(this).filter(p => p.privilege_name.toLowerCase() == name.toLowerCase() || p.privilege_id === 0).length;
	}
}

class UserRoles extends Set {

	constructor(context) {

		super(context.roles);

		this.context = context;
	}
}

class MetaData {

	static async load() {

		MetaData.categories = new Map;
		MetaData.privileges = new Map;
		MetaData.roles = new Map;
		MetaData.datasets = new Map;

		if(!user.id)
			return;

		const metadata = await MetaData.fetch();

		MetaData.save(metadata);
	}

	static async fetch() {

		let
			metadata,
			timestamp;

		try {
			({metadata, timestamp} = JSON.parse(localStorage.metadata));
		} catch(e) {}

		if(!timestamp || Date.now() - timestamp > MetaData.timeout) {
			metadata = await API.call('users/metadata');
			localStorage.metadata = JSON.stringify({metadata, timestamp: Date.now()});
		}

		return metadata;
	}

	static save(metadata = {}) {

		for(const privilege of metadata.privileges || []) {

			privilege.privilege_id = privilege.owner_id;
			delete privilege['owner_id'];

			MetaData.privileges.set(privilege.privilege_id, privilege);
		}

		for(const role of metadata.roles || []) {

			role.role_id = role.owner_id;
			delete role['owner_id'];

			MetaData.roles.set(role.role_id, role);
		}

		for(const category of metadata.categories || []) {

			category.category_id = category.owner_id;
			delete category['owner_id'];

			MetaData.categories.set(category.category_id, category);
		}

		MetaData.visualizations = metadata.visualizations;
		MetaData.datasets = new Map(metadata.datasets.map(d => [d.id, d]));
	}
}

class ErrorLogs {

	static async send(message, path, line, column, stack) {

		if(ErrorLogs.sending)
			return;

		ErrorLogs.sending = true;

		const
			options = {
			method: 'POST'
		},
			params = {
				message : message,
				description : stack && stack.stack,
				url : path,
				type : 'client',
			};

		try {
			await API.call('errors/log',params, options);
		}
		catch (e) {
			console.log('Failed to log error', e);
			return;
		}

		ErrorLogs.sending = false;
	}
}

class AJAX {

	static async call(url, parameters, options = {}) {

		AJAXLoader.show();

		parameters = new URLSearchParams(parameters);

		if(options.method == 'POST') {

			options.body = parameters.toString();

			options.headers = {
				'Content-Type': 'application/x-www-form-urlencoded',
			};
		}

		else
			url += '?' + parameters.toString();

		let response = null;

		try {
			response = await fetch(url, options);
		}
		catch(e) {
			AJAXLoader.hide();
			throw new API.Exception(e.status, 'API Execution Failed');
		}

		AJAXLoader.hide();

		if(response.status == 401)
			return User.logout();

		return await response.json();
	}
}

class API extends AJAX {

	/**
	 * Makes an API call.
	 *
	 * @param  string		endpoint	The endpoint to hit.
	 * @param  parameters	parameters	The api request paramters.
	 * @param  object		options		The options object.
	 * @return Promise					That resolves when the request is completed.
	 */
	static async call(endpoint, parameters = {}, options = {}) {

		if(!endpoint.startsWith('authentication'))
			await API.refreshToken();

		if(localStorage.token) {

			if(typeof parameters == 'string')
				parameters += '&token='+localStorage.token;

			else
				parameters.token = localStorage.token;
		}

		// If a form id was supplied, then also load the data from that form
		if(options.form)
			API.loadFormData(parameters, options.form);

		endpoint = '/api/v2/' + endpoint;

		const response = await AJAX.call(endpoint, parameters, options);

		if(response.status)
			return response.data;

		else
			throw new API.Exception(response);
	}

	/**
	 * This function takes a form id and loads all it's inputs data into the parameters object.
	 *
	 * We use FormData here instead of the a
	 * key/value pair object for two reasons:
	 *
	 * * It lets us pick up all form fields and
	 *	 values automatically without listing them
	 *	 here and worrying about conversions etc.
	 *
	 * * It lets us switch to the more advanced
	 *	 form/multipart Content-Type easily in the
	 *	 future, just comment out the later conversion.
	 *
	 * @param  object	parameters	The parameter list.
	 * @param  string	form		The id of the form whose elements will be picked.
	 */
	static loadFormData(parameters, form) {

		for(const key of form.keys()) {

			let value = form.get(key).trim();

			if(value && !isNaN(value))
				value = parseInt(value);

			parameters[key] = value;
		}
	}

	static async refreshToken() {

		let getToken = true;

		if(localStorage.token) {

			try {

				const user = JSON.parse(atob(localStorage.token.split('.')[1]));

				if(user.exp && user.exp * 1000 > Date.now())
					getToken = false;

			} catch(e) {}
		}

		if(!localStorage.refresh_token || !getToken)
			return;

		const
			parameters = {
				refresh_token: localStorage.refresh_token
			},
			options = {
				method: 'POST',
			};

		if(account.auth_api)
			parameters.access_token = localStorage.access_token;

		const response = await API.call('authentication/refresh', parameters, options);

		localStorage.token = response;

		Page.load();
	}
}

API.Exception = class {

	constructor(response) {
		this.status = response.status;
		this.message = response.message;
	}
}

class AJAXLoader {

	static setup() {

		this.animateEllipses();

		setInterval(() => this.animateEllipses(), 500);
	}

	/**
	 * Show the working flag.
	 */
	static show() {

		if(!AJAXLoader.count)
			AJAXLoader.count = 0;

		AJAXLoader.count++;

		const container = document.getElementById('ajax-working');

		// Because the container may not always be available
		if(!container)
			return;

		container.classList.add('show');
		container.classList.remove('hidden');

		if(AJAXLoader.timeout)
			clearTimeout(AJAXLoader.timeout);
	}

	/**
	 * Hide the flag.
	 */
	static hide() {

		AJAXLoader.count--;

		const container = document.getElementById('ajax-working');

		// Because the container may not always be available or some other request me still be in progress.
		if(!container || AJAXLoader.count)
			return;

		container.classList.remove('show');

		AJAXLoader.timeout = setTimeout(() => container.classList.add('hidden'), 300);
	}

	static animateEllipses() {

		const container = document.getElementById('ajax-working');

		// Because the container may not always be available or some other request me still be in progress.
		if(!container || AJAXLoader.count)
			return;

		this.ellipsesDots = this.ellipsesDots < 3 ? this.ellipsesDots + 1 : 0;

		container.textContent = 'Working' + (new Array(this.ellipsesDots).fill('.').join(''));
	}
}

class Format {

	static date(date) {

		if(typeof date == 'string')
			date = Date.parse(date);

		if(typeof date == 'object' && date)
			date = date.getTime();

		if(!date)
			return '';

		const options = {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		};

		return new Intl.DateTimeFormat('en-IN', options).format(date);
	}

	static number(number) {
		return new Intl.NumberFormat('en-IN').format(number);
	}
}

class Sections {

	static async show(id) {

		for(const section of document.querySelectorAll('main section.section'))
			section.classList.remove('show');

		const container = document.querySelector(`main section.section#${id}`);

		if(container)
			container.classList.add('show');
	}
}

class Editor {

	constructor(container) {

		this.container = container;
		this.editor = ace.edit(container);

		this.editor.setTheme('ace/theme/monokai');
		this.editor.getSession().setMode('ace/mode/sql');
		this.editor.setFontSize(16);
		this.editor.$blockScrolling = Infinity;
	}

	setAutoComplete(list) {

		this.langTools = ace.require('ace/ext/language_tools');

		this.langTools.setCompleters([{
			getCompletions: (_, __, ___, ____, callback) => callback(null, list),
		}]);

		this.editor.setOptions({
			enableBasicAutocompletion: true,
			enableLiveAutocompletion: true,
		});
	}

	get value() {
		return this.editor.getValue();
	}

	set value(value) {
		this.editor.setValue(value || '', 1);
	}
}

class DataSource {

	static async load(force = false) {

		if(DataSource.list && !force)
			return;

		const response = await API.call('reports/report/list');

		DataSource.list = new Map(response.map(report => [report.query_id, report]));
	}

	constructor(source) {

		for(const key in source)
			this[key] = source[key];

		this.tags = this.tags || '';
		this.tags = this.tags.split(',').filter(a => a.trim());

		this.filters = new DataSourceFilters(this);
		this.columns = new DataSourceColumns(this);
		this.transformations = new DataSourceTransformations(this);
		this.visualizations = [];

		if(!source.visualizations)
			source.visualizations = [];

		if(!source.visualizations.filter(v => v.type == 'table').length) {
			source.visualizations.push({ name: 'Table', visualization_id: 0, type: 'table' });
			source.visualizations.push({ name: 'Json', visualization_id: 1, type: 'json' });
		}

		this.visualizations = source.visualizations.map(v => new (Visualization.list.get(v.type))(v, this));
		this.postProcessors = new DataSourcePostProcessors(this);
	}

	async fetch(parameters = {}) {

		parameters = new URLSearchParams(parameters);

		parameters.set('query_id', this.query_id);
		parameters.set('email', user.email);

		if(this.queryOverride)
			parameters.set('query', this.query);

		for(const filter of this.filters.values()) {

			if(filter.dataset && filter.dataset.query_id) {

				if(filter.dataset.containerElement) {

					for(const input of filter.label.querySelectorAll('input:checked'))
						parameters.append(DataSourceFilter.placeholderPrefix + filter.placeholder, input.value);

				} else {

					for(const row of await filter.dataset.fetch())
						parameters.append(DataSourceFilter.placeholderPrefix + filter.placeholder, row.value);
				}

				continue;
			}

			if(this.filters.containerElement)
				parameters.set(DataSourceFilter.placeholderPrefix + filter.placeholder, this.filters.container.elements[filter.placeholder].value);
			else
				parameters.set(DataSourceFilter.placeholderPrefix + filter.placeholder, filter.value);
		}

		let response = null;

		const options = {
			method: 'POST',
		};

		this.resetError();

		try {
			response = await API.call('reports/engine/report', parameters.toString(), options);
		}

		catch(e) {
			this.error(JSON.stringify(e.message, 0, 4));
			response = {};
		}

		if(parameters.get('download'))
			return response;

		this.originalResponse = response;

		this.container.querySelector('.query').innerHTML = response.query;

		let age = response.cached ? Math.floor(response.cached.age * 100) / 100 : 0;

		if(age < 1000)
			age += 'ms';

		else if(age < 1000 * 60)
			age = (age / 1000) + 's';

		else if(age < 1000 * 60 * 60)
			age = (age / (1000 * 60)) + 'h';

		let runtime = Math.floor(response.runtime * 100) / 100;

		if(runtime < 1000)
			runtime += 'ms';

		else if(runtime < 1000 * 60)
			runtime = (runtime / 1000) + 's';

		else if(runtime < 1000 * 60 * 60)
			runtime = (runtime / (1000 * 60)) + 'h';

		this.container.querySelector('.description .cached').textContent = response.cached && response.cached.status ? age : 'No';
		this.container.querySelector('.description .runtime').textContent = runtime;

		this.columns.update();
		this.postProcessors.update();

		this.columns.render();
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('section');

		const container = this.containerElement;

		container.classList.add('data-source');

		container.innerHTML = `

			<header>
				<h2 title="${this.name}">${this.name} <span>#${this.query_id}</span></h2>
				<div class="actions right">
					<a class="reload" title="Reload Report"><i class="fas fa-sync"></i></a>
					<a class="menu-toggle" title="Menu"><i class="fas fa-ellipsis-v"></i></a>
				</div>
			</header>

			<div class="toolbar menu hidden">
				<button type="button" class="filters-toggle"><i class="fa fa-filter"></i> Filters</button>
				<button type="button" class="description-toggle" title="Description"><i class="fa fa-info"></i> Info</button>
				<button type="button" class="view" title="View Report"><i class="fas fa-expand-arrows-alt"></i> Expand</button>
				<button type="button" class="query-toggle" title="View Query"><i class="fas fa-file-alt"></i> Query</button>

				<div class="download-btn" title="Download CSV">
					<button type="button" class="download" title="Download CSV"><i class="fa fa-download"></i><i class="fa fa-caret-down"></i></button>
					<div class="download-dropdown-content hidden">
						<button type="button" class="csv-download"><i class="far fa-file-excel"></i> CSV</button>
						<button type="button" class="xlsx-download"><i class="fas fa-file-excel"></i>xlsx</button>
						<button type="button" class="json-download"><i class="fas fa-code"></i> JSON</button>
					</div>
				</div>
				<select class="change-visualization hidden"></select>
				<button class="export-toggle"><i class="fa fa-download"></i> Export</button>
			</div>

			<div class="columns"></div>
			<div class="query hidden"></div>
			<div class="drilldown hidden"></div>

			<div class="description hidden">
				<div class="body">${this.description}</div>
				<div class="footer">
					<span>
						<span class="label">Role:</span>
						<span>${MetaData.roles.has(this.roles) ? MetaData.roles.has(this.roles).name : 'Invalid'}</span>
					</span>
					<span>
						<span class="label">Added On:</span>
						<span>${Format.date(this.created_at)}</span>
					</span>
					<span>
						<span class="label">Cached:</span>
						<span class="cached"></span>
					</span>
					<span>
						<span class="label">Runtime:</span>
						<span class="runtime"></span>
					</span>
					<span class="right">
						<span class="label">Added By:</span>
						<span>${this.added_by_name || 'NA'}</span>
					</span>
					<span>
						<span class="label">Requested By:</span>
						<span>${this.requested_by || 'NA'}</span>
					</span>
				</div>
			</div>

			<div class="export-json hidden">
				${JSON.stringify(DataSource.list.get(this.query_id))}
			</div>
		`;

		container.querySelector('.menu .export-toggle').on('click', () => {
			container.querySelector('.export-json').classList.toggle('hidden');
			container.querySelector('.export-toggle').classList.toggle('selected');

			this.visualizations.selected.render(true);
		});

		container.querySelector('header .menu-toggle').on('click', () => {
			container.querySelector('.menu').classList.toggle('hidden');
			container.querySelector('header .menu-toggle').classList.toggle('selected');

			this.visualizations.selected.render(true);
		});

		container.querySelector('header .reload').on('click', () => {
			this.visualizations.selected.load(true);
		});

		container.querySelector('.menu .filters-toggle').on('click', () => {

			container.querySelector('.filters-toggle').classList.toggle('selected');

			if(container.contains(this.filters.container))
				container.removeChild(this.filters.container);

			else container.insertBefore(this.filters.container, container.querySelector('.columns'));

			this.visualizations.selected.render(true);
		});

		container.querySelector('.menu .description-toggle').on('click', () => {

			container.querySelector('.description').classList.toggle('hidden');
			container.querySelector('.description-toggle').classList.toggle('selected');

			this.visualizations.selected.render(true);
		});

		container.querySelector('.menu .query-toggle').on('click', () => {

			container.querySelector('.query').classList.toggle('hidden');
			container.querySelector('.query-toggle').classList.toggle('selected');

			this.visualizations.selected.render(true);
		});

		container.querySelector('.menu .download-btn .download').on('click', (e) => {
			container.querySelector('.menu .download-btn .download').classList.toggle('selected');
			container.querySelector('.menu .download-btn .download-dropdown-content').classList.toggle('hidden');
		});

		container.querySelector('.menu .csv-download').on('click', (e) => this.download(e, {mode: 'csv'}));
		container.querySelector('.menu .json-download').on('click', (e) => this.download(e, {mode: 'json'}));
		container.querySelector('.menu .xlsx-download').on('click', (e) => this.download(e, {mode: 'xlsx'}));

		if(user.privileges.has('report')) {

			const
				configure = document.createElement('a'),
				actions = container.querySelector('header .actions');

			configure.title = 'Configure Visualization';
			configure.classList.add('configure-visualization');
			configure.innerHTML = '<i class="fas fa-cog"></i>';

			actions.insertBefore(configure, actions.querySelector('.menu-toggle'));

			const edit = document.createElement('a');

			edit.title = 'Edit Report';
			edit.href = `/reports/${this.query_id}`;
			edit.innerHTML = '<i class="fas fa-pencil-alt"></i>';

			actions.insertBefore(edit, actions.querySelector('.menu-toggle'));
		}

		else container.querySelector('.menu .query-toggle').classList.add('hidden');

		container.querySelector('.menu .view').on('click', () => window.location = `/report/${this.query_id}`);

		if(this.visualizations.length) {

			const select = container.querySelector('.change-visualization');

			for(const [i, v] of this.visualizations.entries()) {

				if(v.default)
					this.visualizations.selected = v;

				select.insertAdjacentHTML('beforeend', `<option value="${i}">${v.type}</option>`);
			}

			select.on('change', async () => {
				this.visualizations[select.value].load();
			});

			if(!this.visualizations.selected)
				this.visualizations.selected = this.visualizations[select.value];

			if(this.visualizations.length > 1)
				select.classList.remove('hidden');

			if(this.visualizations.selected)
				container.appendChild(this.visualizations.selected.container);
		}

		this.xlsxDownloadable = ["line", "bar",].includes(this.visualizations.selected.type);

		const xlsxDownloadDropdown = this.container.querySelector(".xlsx-download");
		if(!this.xlsxDownloadable) {

			xlsxDownloadDropdown.classList.toggle('hidden', true)
		}
		else
			xlsxDownloadDropdown.classList.toggle('hidden', false)

		if(!this.filters.size)
			container.querySelector('.filters-toggle').classList.add('hidden');

		container.querySelector('.menu').insertBefore(this.postProcessors.container, container.querySelector('.description-toggle'));

		if(this.drilldown) {

			let source = this;

			const list = container.querySelector('.drilldown');

			list.textContent = null;

			while(source.drilldown) {

				const
					copy = source,
					fragment = document.createDocumentFragment(),
					link = document.createElement('a')

				link.innerHTML = `${source.drilldown.parent.name}`;

				const title = [];

				for(const p of source.drilldown.parameters)
					title.push(`${p.value}: ${p.selectedValue instanceof Dataset ? p.selectedValue.value : p.selectedValue}`);

				link.title = title.join('\n');

				link.on('click', () => {

					const parent = this.container.parentElement;

					parent.removeChild(this.container);
					parent.appendChild(copy.drilldown.parent.container);
					copy.drilldown.parent.visualizations.selected.render();
				});

				fragment.appendChild(link);

				if(list.children.length) {

					const angle = document.createElement('i');

					angle.classList.add('fas', 'fa-angle-right');

					fragment.appendChild(angle);

					list.insertBefore(fragment, list.children[0]);
				}

				else list.appendChild(fragment);

				source = source.drilldown.parent;
			}
		}

		this.columns.render();

		return container;
	}

	get response() {

		if(!this.originalResponse.data)
			return [];

		let response = [];

		this.originalResponse.groupedAnnotations = new Map;

		const data = this.transformations.run(this.originalResponse.data);

		for(const _row of data) {

			const row = new DataSourceRow(_row, this);

			if(!row.skip)
				response.push(row);
		}

		if(this.postProcessors.selected)
			response = this.postProcessors.selected.processor(response);

		if(response.length && this.columns.sortBy && response[0].has(this.columns.sortBy.key)) {
			response.sort((a, b) => {

				const
					first = a.get(this.columns.sortBy.key).toString().toLowerCase(),
					second = b.get(this.columns.sortBy.key).toString().toLowerCase();

				let result = 0;

				if(!isNaN(first) && !isNaN(second))
					result = first - second;

				else if(first < second)
					result = -1;

				else if(first > second)
					result = 1;

				if(!this.columns.sortBy.sort)
					result *= -1;

				return result;
			});
		}

		return response;
	}


	async download(e, what) {

		this.containerElement.querySelector('.menu .download-btn .download').classList.remove('selected');
		e.currentTarget.parentElement.classList.add('hidden');

		const response = await this.fetch({download: 1});

		let str = [];

		if(what.mode == 'json') {

			for(const data of response.data) {

				const line = [];

				line.push(JSON.stringify(data));

				str.push(line);
			}
		}

		else if(what.mode == 'xlsx' && this.xlsxDownloadable) {

			const response = [];

			for(const row of this.response) {
				const temp = {};
				const arr = [...row];
				for(const cell of arr) {
					temp[cell[0]] = cell[1];
				}
				response.push(temp)
			}


			const obj = {
				columns		 :[...this.columns.entries()].map(x => x[0]),
				left		 :((this.visualizations.selected.options.axes).left   || {columns: [{}]}).columns[0].key,
				right		 :((this.visualizations.selected.options.axes).right  || {columns: [{}]}).columns[0].key,
				top			 :((this.visualizations.selected.options.axes).top    || {columns: [{}]}).columns[0].key,
				bottom		 :((this.visualizations.selected.options.axes).bottom || {columns: [{}]}).columns[0].key,
				visualization:this.visualizations.selected.type,
				sheet_name	 :this.name.split(" ").join("_"),
				file_name	 :this.name.split(" ").join("_"),

			};

			return await this.excelSheetDownloader(response, obj);
		}

		else {

			for(const data of response.data) {

				const line = [];

				for(const index in data)
					line.push(JSON.stringify(String(data[index])));

				str.push(line.join());
			}

			str = Object.keys(response.data[0]).join() + '\r\n' + str.join('\r\n');
		}

		const
			a = document.createElement('a'),
			blob = new Blob([str], {type: 'application\/octet-stream'}),
			fileName = [
				this.name,
			];

		if(this.filters.has('Start Date'))
			fileName.push(this.filters.container.elements[this.filters.get('Start Date').placeholder].value);

		if(this.filters.has('End Date'))
			fileName.push(this.filters.container.elements[this.filters.get('End Date').placeholder].value);

		if(fileName.length == 1)
			fileName.push(new Intl.DateTimeFormat('en-IN', {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'}).format(new Date));

		a.href = window.URL.createObjectURL(blob);

		a.download = fileName.join(' - ') + '.' + what.mode;

		a.click();
	}

	async excelSheetDownloader(data, obj) {

		obj.data = data
		const xlsxBlobOutput = await DataSource.postData("/api/v2/reports/engine/download", obj);


		const link = document.createElement('a');
		link.href = window.URL.createObjectURL(xlsxBlobOutput);
		link.download = obj.file_name + "_" + new Date().getTime() + ".xlsx";
		link.click();
	}


	static async postData(url, data) {

		return await (await (fetch(url, {
			body: JSON.stringify(data),
			cache: 'no-cache',
			credentials: 'same-origin',
			headers: {
				'user-agent': 'Mozilla/4.0 MDN Example',
				'content-type': 'application/json'
			},
			method: 'POST',
			mode: 'cors',
			redirect: 'follow',
			referrer: 'no-referrer',
		}))).blob();

	}


	get link() {

		const link = window.location.origin + '/report/' + this.query_id;

		const parameters = new URLSearchParams();

		for(const [_, filter] of this.filters) {
			if(this.filters.container && filter.placeholder in this.filters.container.elements)
				parameters.set(filter.placeholder, this.filters.container.elements[filter.placeholder].value);
		}

		return link + '?' + parameters.toString();
	}

	resetError() {

		if(this.container.querySelector('pre.warning'))
			this.container.removeChild(this.container.querySelector('pre.warning'));

		this.visualizations.selected.container.classList.remove('hidden');
	}

	error(message) {

		this.resetError();

		this.container.insertAdjacentHTML('beforeend', `
			<pre class="warning">${message}</pre>
		`);

		this.visualizations.selected.container.classList.add('hidden');
	}
}

class DataSourceFilters extends Map {


	constructor(source) {

		super();

		this.source = source;

		if(!this.source.filters || !this.source.filters.length)
			return;

		for(const filter of this.source.filters)
			this.set(filter.placeholder, new DataSourceFilter(filter, this.source));
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('form');

		container.classList.add('toolbar', 'form', 'filters');

		for(const filter of this.values())
			container.appendChild(filter.label);

		container.on('submit', e => this.source.visualizations.selected.load(e));

		container.insertAdjacentHTML('beforeend', `
			<label class="right">
				<span>&nbsp;</span>
				<button type="reset">
					<i class="fa fa-undo"></i> Reset
				</button>
			</label>
			<label>
				<span>&nbsp;</span>
				<button type="submit">
					<i class="fa fa-sync"></i> Submit
				</button>
			</label>
		`);

		return container;
	}
}

class DataSourceFilter {

	static setup() {

		DataSourceFilter.types = {
			1: 'text',
			0: 'number',
			2: 'date',
			3: 'month',
			4: 'city',
		};

		DataSourceFilter.placeholderPrefix = 'param_';
	}

	constructor(filter, source) {

		for(const key in filter)
			this[key] = filter[key];

		this.source = source;

		if(this.dataset && MetaData.datasets.has(this.dataset))
			this.dataset = new Dataset(this.dataset, this);

		else this.dataset = null;
	}

	get label() {

		if(this.labelContainer)
			return this.labelContainer;

		const container = document.createElement('label');

		let input = document.createElement('input');

		input.type = DataSourceFilter.types[this.type];
		input.name = this.placeholder;

		if(input.name.toLowerCase() == 'sdate' || input.name.toLowerCase() == 'edate')
			input.max = new Date().toISOString().substring(0, 10);

		input.value = this.value;

		if(this.dataset)
			input = this.dataset.container;

		container.innerHTML = `<span>${this.name}<span>`;

		container.appendChild(input);

		return this.labelContainer = container;
	}

	get value() {

		if(this.dataset && this.dataset.query_id)
			return this.dataset;

		if(this.labelContainer)
			return this.label.querySelector('input').value;

		let value = this.default_value;

		if(!isNaN(parseFloat(this.offset))) {

			if(DataSourceFilter.types[this.type] == 'date')
				value = new Date(Date.now() + this.offset * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

			if(DataSourceFilter.types[this.type] == 'month') {
				const date = new Date();
				value = new Date(Date.UTC(date.getFullYear(), date.getMonth() + this.offset, 1)).toISOString().substring(0, 7);
			}
		}

		return value;
	}

	set value(value) {

		if(this.dataset)
			return this.dataset.value = value;

		this.label.querySelector('input').value = value;
	}
}

class DataSourceRow extends Map {

	constructor(row, source) {

		super();

		for(const key in row)
			this.set(key, row[key]);

		this.source = source;

		if(!row) {
			this.annotations = new Set();
			return;
		}

		this.clear();

		const
			columnsList = this.source.columns.list,
			columnKeys = [...columnsList.keys()];

		for(const [key, column] of columnsList) {

			if(column.formula) {

				let formula = column.formula;

				for(const column of columnsList.values()) {

					if(!formula.includes(column.key))
						continue;

					let value = parseFloat(row[column.key]);

					if(isNaN(value))
						value = `'${row[column.key]}'` || '';

					formula = formula.replace(new RegExp(column.key, 'gi'), value);
				}

				try {

					row[key] = eval(formula);

					if(!isNaN(parseFloat(row[key])))
						row[key] = parseFloat(row[key]);

				} catch(e) {
					row[key] = null;
				}
			}

			if(column.filtered) {

				if(!row[key])
					this.skip = true;

				if(!DataSourceColumn.searchTypes[parseInt(column.searchType) || 0].apply(column.searchQuery, row[key] === null ? '' : row[key]))
					this.skip = true;
			}

			this.set(key, row[key] || 0);
		}

		// Sort the row by position of their columns in the source's columns map
		const values = [...this.entries()].sort((a, b) => columnKeys.indexOf(a[0]) - columnKeys.indexOf(b[0]));

		this.clear();

		for(const [key, value] of values)
			this.set(key, value);

		this.annotations = new Set();
	}
}

class DataSourceColumns extends Map {

	constructor(source) {

		super();

		this.source = source;
	}

	update(response) {

		if(!this.source.originalResponse.data || !this.source.originalResponse.data.length)
			return;

		this.clear();

		for(const column in response ? response[0] : this.source.originalResponse.data[0])
			this.set(column, new DataSourceColumn(column, this.source));
	}

	render() {

		const
			container = this.source.container.querySelector('.columns'),
			drilldown = [];

		container.textContent = null;

		for(const column of this.values()) {

			container.appendChild(column.container);

			if(column.drilldown && column.drilldown.query_id)
				drilldown.push(column.name);
		}

		if(!this.size)
			container.innerHTML = '&nbsp;';

		if(!drilldown.length)
			return;

		const
			actions = this.source.container.querySelector('header .actions'),
			old = actions.querySelector('.drilldown');

		if(old)
			old.remove();

		actions.insertAdjacentHTML('afterbegin', `
			<span class="grey"><i class="fas fa-angle-double-down"></i></span>
		`);
	}

	get list() {

		const result = new Map;

		for(const [key, column] of this) {

			if(!column.disabled)
				result.set(key, column);
		}

		return result;
	}
}

class DataSourceColumn {

	constructor(column, source) {

		DataSourceColumn.colors = [
			'#8595e1',
			'#ef6692',
			'#d6bcc0',
			'#ffca05',
			'#8dd593',
			'#ff8b75',
			'#2a0f54',
			'#d33f6a',
			'#f0b98d',
			'#6c54b5',
			'#bb7784',
			'#b5bbe3',
			'#0c8765',
			'#ef9708',
			'#1abb9c',
			'#9da19c',
		];

		DataSourceColumn.searchTypes = [
			{
				name: 'Contains',
				apply: (q, v) => v.toString().toLowerCase().includes(q.toString().toLowerCase()),
			},
			{
				name: 'Not Contains',
				apply: (q, v) => !v.toString().toLowerCase().includes(q.toString().toLowerCase()),
			},
			{
				name: '=',
				apply: (q, v) => v.toString().toLowerCase() == q.toString().toLowerCase(),
			},
			{
				name: '!=',
				apply: (q, v) => v.toString().toLowerCase() != q.toString().toLowerCase(),
			},
			{
				name: '>',
				apply: (q, v) => v > q,
			},
			{
				name: '<',
				apply: (q, v) => v < q,
			},
			{
				name: '>=',
				apply: (q, v) => v >= q,
			},
			{
				name: '<=',
				apply: (q, v) => v <= q,
			},
			{
				name: 'Regular Expression',
				apply: (q, v) => q.toString().match(new RegExp(q, 'i')),
			},
		];

		DataSourceColumn.accumulationTypes = [
			{
				name: 'sum',
				apply: (rows, column) => Format.number(rows.reduce((c, v) => c + parseFloat(v.get(column)), 0)),
			},
			{
				name: 'average',
				apply: (rows, column) => Format.number(rows.reduce((c, v) => c + parseFloat(v.get(column)), 0) / rows.length),
			},
			{
				name: 'max',
				apply: (rows, column) => Format.number(Math.max(...rows.map(r => r.get(column)))),
			},
			{
				name: 'min',
				apply: (rows, column) => Format.number(Math.min(...rows.map(r => r.get(column)))),
			},
			{
				name: 'distinct',
				apply: (rows, column) => Format.number(new Set(rows.map(r => r.get(column))).size),
			},
		];

		this.key = column;
		this.source = source;
		this.name = this.key.split('_').map(w => w.trim()[0].toUpperCase() + w.trim().slice(1)).join(' ');
		this.disabled = 0;
		this.color = DataSourceColumn.colors[this.source.columns.size % DataSourceColumn.colors.length];

		if(this.source.format && this.source.format.columns) {

			const [format] = this.source.format.columns.filter(column => column.key == this.key);

			for(const key in format || {})
				this[key] = format[key];
		}
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('column');

		container.innerHTML = `
			<span class="color" style="background: ${this.color}"></span>
			<span class="name">${this.name}</span>

			<div class="blanket hidden">
				<form class="block form">

					<h3>Column Properties</h3>

					<label>
						<span>Key</span>
						<input type="text" name="key" value="${this.key}" disabled readonly>
					</label>

					<label>
						<span>Name</span>
						<input type="text" name="name" value="${this.name}" >
					</label>

					<label>
						<span>Search</span>
						<div class="search">
							<select name="searchType"></select>
							<input type="search" name="searchQuery">
						</div>
					</label>

					<label>
						<span>Type</span>
						<select name="type">
							<option value="string">String</option>
							<option value="number">Number</option>
							<option value="date">Date</option>
						</select>
					</label>

					<label>
						<span>Color</span>
						<input type="color" name="color">
					</label>

					<label>
						<span>Sort</span>
						<select name="sort">
							<option value="-1">None</option>
							<option value="0">Descending</option>
							<option value="1">Ascending</option>
						</select>
					</label>

					<label>
						<span>Formula</span>
						<input type="text" name="formula">
						<small></small>
					</label>

					<label>
						<span>Prefix</span>
						<input type="text" name="prefix">
					</label>

					<label>
						<span>Postfix</span>
						<input type="text" name="postfix">
					</label>

					<label>
						<span>Disabled</span>
						<select name="disabled">
							<option value="0">No</option>
							<option value="1">Yes</option>
						</select>
					</label>

					<h3>Drill down</h3>

					<label>
						<span>Report</span>
						<select name="drilldown_query_id">
							<option value=""></option>
						</select>
					</label>

					<label>
						<span>Parameters</span>
						<button type="button" class="add-parameters"><i class="fa fa-plus"></i> Add New</button>
					</label>

					<div class="parameter-list"></div>

					<footer>

						<button type="button" class="cancel">
							<i class="far fa-times-circle"></i> Cancel
						</button>

						<button type="button" class="apply">
							<i class="fas fa-check"></i> Apply
						</button>

						<button type="submit">
							<i class="fa fa-save"></i> Save
						</button>
					</footer>
				</form>
			</div>
		`;

		this.blanket = container.querySelector('.blanket');
		this.form = this.blanket.querySelector('.form');

		this.form.elements.formula.on('keyup', async () => {

			if(this.formulaTimeout)
				clearTimeout(this.formulaTimeout);

			this.formulaTimeout = setTimeout(() => this.validateFormula(), 200);
		});

		if(user.privileges.has('report')) {

			const edit = document.createElement('a');

			edit.classList.add('edit-column');
			edit.title = 'Edit Column';
			edit.on('click', () => this.edit());

			edit.innerHTML = `<i class="fas fa-ellipsis-v"></i>`;

			this.container.appendChild(edit);
		}

		this.form.on('submit', async e => this.save(e));

		this.blanket.on('click', () => this.blanket.classList.add('hidden'));

		this.form.on('click', e => e.stopPropagation());

		for(const [i, type] of DataSourceColumn.searchTypes.entries()) {

			this.form.searchType.insertAdjacentHTML('beforeend', `
				<option value="${i}">${type.name}</option>
			`);
		}

		for(const report of DataSource.list.values()) {

			this.form.drilldown_query_id.insertAdjacentHTML('beforeend', `
				<option value="${report.query_id}">${report.name}</option>
			`);
		}

		this.form.drilldown_query_id.on('change', () => this.updateDrilldownParamters());
		this.updateDrilldownParamters();

		let timeout;

		container.querySelector('.name').on('click', async () => {

			clearTimeout(timeout);

			timeout = setTimeout(async () => {

				this.disabled = !this.disabled;

				this.source.columns.render();

				await this.update();
			}, 300);
		});

		this.form.querySelector('.add-parameters').on('click', () => {
			this.addParameterDiv();
			this.updateDrilldownParamters();
		});

		this.form.querySelector('.cancel').on('click', () => this.blanket.classList.add('hidden'));
		this.form.querySelector('.apply').on('click', () => this.apply());

		container.querySelector('.name').on('dblclick', async (e) => {

			clearTimeout(timeout);

			for(const column of this.source.columns.values()) {

				if(column.key == this.key || (this.source.visualizations.selected.axes && column.key == this.source.visualizations.selected.axes.bottom.column))
					continue;

				column.disabled = true;
				column.source.columns.render();
				await column.update();
			}

			this.disabled = false;

			this.source.columns.render();

			await this.update();
		})

		this.setDragAndDrop();

		return container;
	}

	edit() {

		for(const key in this) {

			if(key in this.form)
				this.form[key].value = this[key];
		}

		if(this.drilldown) {

			this.form.querySelector('.parameter-list').textContent = null;

			this.form.drilldown_query_id.value = this.drilldown ? this.drilldown.query_id : '';

			for(const param of this.drilldown.parameters || [])
				this.addParameterDiv(param);

			this.updateDrilldownParamters();
		}

		this.blanket.classList.remove('hidden');
	}

	addParameterDiv(parameter = {}) {

		const container = document.createElement('div');

		container.innerHTML = `
			<label>
				<span>Filter</span>
				<select name="placeholder" value="${parameter.placeholder || ''}"></select>
			</label>

			<label>
				<span>Type</span>
				<select name="type" value="${parameter.type || ''}">
					<option value="column">Column</option>
					<option value="filter">Filter</option>
					<option value="static">Custom</option>
				</select>
			</label>

			<label>
				<span>Value</span>
				<select name="value" value="${parameter.value || ''}"></select>
			</label>

			<label>
				<span>&nbsp;</span>
				<button type="button" class="delete">
					<i class="far fa-trash-alt"></i> Delete
				</button>
			</label>
		`;

		container.classList.add('parameter');

		const parameterList = this.form.querySelector('.parameter-list');

		parameterList.appendChild(container);

		container.querySelector('select[name=type]').on('change', () => this.updateDrilldownParamters(true));

		container.querySelector('.delete').on('click', () => {
			parameterList.removeChild(container);
		});

		this.blanket.on('click', () => this.blanket.classList.add('hidden'));
	}

	updateDrilldownParamters(updatingType) {

		const
			parameterList = this.form.querySelector('.parameter-list'),
			parameters = parameterList.querySelectorAll('.parameter'),
			report = DataSource.list.get(parseInt(this.form.drilldown_query_id.value));

		if(report && report.filters.length) {

			for(const parameter of parameters) {

				const
					placeholder = parameter.querySelector('select[name=placeholder]'),
					type = parameter.querySelector('select[name=type]'),
					value = parameter.querySelector('select[name=value]');

				placeholder.textContent = null;

				for(const filter of report.filters)
					placeholder.insertAdjacentHTML('beforeend', `<option value="${filter.placeholder}">${filter.name}</option>`);

				if(placeholder.getAttribute('value'))
					placeholder.value = placeholder.getAttribute('value');

				if(!updatingType && type.getAttribute('value'))
					type.value = type.getAttribute('value');

				value.textContent = null;

				if(type.value == 'column') {

					for(const column of this.source.columns.list.values())
						value.insertAdjacentHTML('beforeend', `<option value="${column.key}">${column.name}</option>`);
				}

				else if(type.value == 'filter') {

					for(const filter of this.source.filters.values())
						value.insertAdjacentHTML('beforeend', `<option value="${filter.placeholder}">${filter.name}</option>`);
				}

				if(value.getAttribute('value'))
					value.value = value.getAttribute('value');
			}
		}

		else parameterList.textContent = null;

		parameterList.classList.toggle('hidden', !parameters.length || !report || !report.filters.length);
		this.form.querySelector('.add-parameters').parentElement.classList.toggle('hidden', !report || !report.filters.length);
	}

	async apply() {

		for(const element of this.form.elements)
			this[element.name] = isNaN(element.value) ? element.value || null : element.value == '' ? null : parseFloat(element.value);

		this.container.querySelector('.name').textContent = this.name;
		this.container.querySelector('.color').style.background = this.color;
		await this.source.visualizations.selected.render();
		this.blanket.classList.add('hidden');
	}

	async save(e) {

		if(e)
			e.preventDefault();

		if(!this.source.format)
			this.source.format = {};

		if(!this.source.format.columns)
			this.source.format.columns = [];

		let
			response,
			updated = 0,
			json_param = [];

		for(const element of this.form.elements)
			this[element.name] = isNaN(element.value) ? element.value || null : element.value == '' ? null : parseFloat(element.value);

		for(const row of this.form.querySelectorAll('.parameter')) {

			let param_json = {};

			for(const select of row.querySelectorAll('select'))
				param_json[select.name] = select.value;

			json_param.push(param_json);
		}

		response = {
			key : this.key,
			name : this.name,
			type : this.type,
			disabled : this.disabled,
			color : this.color,
			searchType : this.searchType,
			searchQuery : this.searchQuery,
			sort : this.sort,
			prefix : this.prefix,
			postfix : this.postfix,
			formula : this.formula,
			drilldown : {
				query_id : this.drilldown_query_id,
				parameters : json_param
			}
		};

		for(const [i, column] of this.source.format.columns.entries()) {

			if(column.key == this.key) {
				this.source.format.columns[i] = response;
				updated = 1;
				break;
			}
		}

		if(updated == 0) {
			this.source.format.columns.push(response);
		}

		const
			parameters = {
				query_id : this.source.query_id,
				format : JSON.stringify(this.source.format),
			},
			options = {
				method: 'POST',
			};

		await API.call('reports/report/update', parameters, options);
		await this.apply();

		this.blanket.classList.add('hidden');
	}

	async update() {

		this.render();

		this.blanket.classList.add('hidden');

		//this.container.classList.toggle('error', this.form.elements.formula.classList.contains('error'));

		this.source.columns.render();
		await this.source.visualizations.selected.render();
	}

	render() {

		this.container.querySelector('.name').textContent = this.name;

		this.container.classList.toggle('disabled', this.disabled);
		this.container.classList.toggle('filtered', this.filtered ? true : false);
	}

	validateFormula() {

		let formula = this.form.elements.formula.value;

		for(const column of this.source.columns.values()) {

			if(formula.includes(column.key))
				formula = formula.replace(new RegExp(column.key, 'gi'), 1);
		}

		try {
			eval(formula);
		}

		catch(e) {

			this.form.elements.formula.classList.add('error');
			this.form.elements.formula.parentElement.querySelector('small').textContent = e.message;

			return;
		}

		this.form.elements.formula.classList.remove('error');
		this.form.elements.formula.parentElement.querySelector('small').innerHTML = '&nbsp;';
	}

	setDragAndDrop() {

		const container = this.container;

		container.setAttribute('draggable', 'true');

		container.on('dragstart', e => {
			this.source.columns.beingDragged = this;
			e.effectAllowed = 'move';
			container.classList.add('being-dragged');
			this.source.container.querySelector('.columns').classList.add('being-dragged');
		});

		container.on('dragend', () => {
			container.classList.remove('being-dragged');
			this.source.container.querySelector('.columns').classList.remove('being-dragged');
		});

		container.on('dragenter', e => {
			container.classList.add('drag-enter');
		});

		container.on('dragleave', () =>  {
			container.classList.remove('drag-enter');
		});

		// To make the targate droppable
		container.on('dragover', e => e.preventDefault());

		container.on('drop', e => {

			container.classList.remove('drag-enter');

			if(this.source.columns.beingDragged == this)
				return;

			this.source.columns.delete(this.source.columns.beingDragged.key);

			const columns = [...this.source.columns.values()];

			this.source.columns.clear();

			for(const column of columns) {

				if(column == this)
					this.source.columns.set(this.source.columns.beingDragged.key, this.source.columns.beingDragged);

				this.source.columns.set(column.key, column);
			}

			this.source.visualizations.selected.render();
			this.source.columns.render();
		});
	}

	async initiateDrilldown(row) {

		if(!this.drilldown || !parseInt(this.drilldown.query_id) || !this.drilldown.parameters)
			return;

		let destination = DataSource.list.get(parseInt(this.drilldown.query_id));

		if(!destination)
			return;

		destination = new DataSource(destination);

		const destinationDatasets = [];

		for(const filter of destination.filters.values()) {

			if(filter.dataset)
				destinationDatasets.push(filter.dataset.load());
		}

		await Promise.all(destinationDatasets);

		for(const parameter of this.drilldown.parameters) {

			if(!destination.filters.has(parameter.placeholder))
				continue;

			const filter = destination.filters.get(parameter.placeholder);

			let value;

			if(parameter.type == 'column')
				value = row.get(parameter.value);

			else if(parameter.type == 'filter')
				value = this.source.filters.get(parameter.value).value;

			else if(parameter.type == 'static')
				value = parameter.value;

			filter.value = value;
			parameter.selectedValue = value;
		}

		destination.drilldown = {
			...this.drilldown,
			parent: this.source,
		};

		destination.container.setAttribute('style', this.source.container.getAttribute('style'));

		const parent = this.source.container.parentElement;

		parent.removeChild(this.source.container);
		parent.appendChild(destination.container);

		destination.container.querySelector('.drilldown').classList.remove('hidden');

		destination.visualizations.selected.load();
	}

	get search() {

		if(this.searchContainer)
			return this.searchContainer;

		const
			container = this.searchContainer = document.createElement('th'),
			searchTypes = DataSourceColumn.searchTypes.map((type, i) => `<option value="${i}">${type.name}</option>`).join('');

		container.innerHTML = `
			<div>
				<select class="search-type">${searchTypes}</select>
				<input type="search" class="query" placeholder="${this.name}">
			</div>
		`;

		const
			select = container.querySelector('.search-type'),
			query = container.querySelector('.query');

		select.on('change', () => {
			this.searchType = select.value;
			this.searchQuery = query.value;
			this.filtered = this.searchQuery !== null && this.searchQuery !== '';
			this.accumulation.run();
			this.source.visualizations.selected.render();
			setTimeout(() => select.focus());
		});

		query.on('keyup', () => {
			this.searchType = select.value;
			this.searchQuery = query.value;
			this.filtered = this.searchQuery !== null && this.searchQuery !== '';
			this.accumulation.run();
			this.source.visualizations.selected.render();
			setTimeout(() => query.focus());
		});

		return container;
	}

	get accumulation() {

		if(this.accumulationContainer)
			return this.accumulationContainer;

		const
			container = this.accumulationContainer = document.createElement('th'),
			accumulationTypes = DataSourceColumn.accumulationTypes.map((type, i) => `
				<option>${type.name}</option>
			`).join('');

		container.innerHTML = `
			<div>
				<select>
					<option>&#402;</option>
					${accumulationTypes}
				</select>
				<span class="result"></span>
			</div>
		`;

		const
			select = container.querySelector('select'),
			result = container.querySelector('.result');

		select.on('change', () => container.run());

		container.run = () => {

			const
				data = this.source.response,
				accumulation = DataSourceColumn.accumulationTypes.filter(a => a.name == select.value);

			if(select.value && accumulation.length) {

				const value = accumulation[0].apply(data, this.key);

				result.textContent = value == 'NaN' ? '' : value;
			}

			else result.textContent = '';
		}

		return container;
	}

	get heading() {

		if(this.headingContainer)
			return this.headingContainer;

		const container = this.headingContainer = document.createElement('th');

		container.classList.add('heading');

		container.innerHTML = `
			${this.drilldown && this.drilldown.query_id ? '<span class="drilldown"><i class="fas fa-angle-double-down"></i></span>' : ''}
			<span class="name">${this.name}</span>
			<span class="sort"><i class="fa fa-sort"></i></span>
		`;

		container.on('click', () => {
			this.source.columns.sortBy = this;
			this.sort = !this.sort;
			this.source.visualizations.selected.render();
		});

		return container;
	}
}

class DataSourcePostProcessors {

	constructor(source) {

		this.source = source;

		this.list = new Map;

		for(const [key, processor] of DataSourcePostProcessors.processors)
			this.list.set(key, new processor(this.source, key));

		if(source.postProcessor && this.list.has(source.postProcessor.name))
			this.selected = this.list.get(source.postProcessor.name);
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const
			container = this.containerElement = document.createDocumentFragment(),
			processors = document.createElement('select');

		processors.classList.add('postprocessors', 'hidden');

		for(const [key, processor] of this.list) {

			processors.insertAdjacentHTML('beforeend', `<option value="${key}">${processor.name}</option>`);

			container.appendChild(processor.container);
		}

		if(this.selected) {
			processors.value = this.selected.key;
			this.selected.container.classList.remove('hidden');
		}

		processors.on('change', () => {

			this.selected = this.list.get(processors.value);

			for(const [key, processor] of this.list)
				processor.container.classList.toggle('hidden', key == 'Orignal' || key != processors.value);

			this.source.visualizations.selected.render();
		});

		container.appendChild(processors);

		return container;
	}

	update() {

		const container = this.source.container.querySelector('.postprocessors');

		if(container)
			container.classList.toggle('hidden', !this.source.columns.has('timing'));
	}
}

class DataSourcePostProcessor {

	constructor(source, key) {
		this.source = source;
		this.key = key;
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('select');

		container.classList.add('hidden');

		for(const [value, name] of this.domain)
			container.insertAdjacentHTML('beforeend', `<option value="${value}">${name}</option>`);

		if(this.source.postProcessor && this.source.postProcessor.value && this.source.postProcessors.selected == this)
			container.value = this.source.postProcessor.value;

		container.on('change', () => this.source.visualizations.selected.render());

		return container;
	}
}

class DataSourceTransformations extends Set {

	constructor(source) {

		super();

		this.source = source;

		const transformations = this.source.format && this.source.format.transformations ? this.source.format.transformations : [];

		for(const transformation of transformations)
			this.add(new DataSourceTransformation(transformation, this.source));
	}

	run(response) {

		response = JSON.parse(JSON.stringify(response));

		for(const transformation of this)
			response = transformation.run(response);

		if(this.size) {
			this.source.columns.update(response);
			this.source.columns.render();
		}

		return response;
	}
}

class DataSourceTransformation {

	constructor(transformation, source) {

		this.source = source;

		for(const key in transformation)
			this[key] = transformation[key];
	}

	run(response = []) {

		if(!response || !response.length || !this.rows || this.rows.length != 1)
			return response;

		const
			[{column: groupColumn}] = this.columns.length ? this.columns : [{}],
			[{column: groupRow}] = this.rows;

		if(!groupRow)
			return response;

		const
			columns = new Set,
			rows = new Map;

		if(groupColumn) {

			for(const row of response) {
				if(!columns.has(row[groupColumn]))
					columns.add(row[groupColumn]);
			}
		}

		for(const responseRow of response) {

			if(!rows.get(responseRow[groupRow]))
				rows.set(responseRow[groupRow], new Map);

			const row = rows.get(responseRow[groupRow]);

			if(groupColumn) {

				for(const column of columns) {

					if(!row.has(column))
						row.set(column, []);

					if(responseRow[groupColumn] != column)
						continue;

					row.get(column).push(responseRow[this.values[0].column]);
				}
			} else {

				for(const value of this.values || []) {

					if(!(value.column in responseRow))
						continue;

					if(!row.has(value.column))
						row.set(value.column, []);

					row.get(value.column).push(responseRow[value.column])
				}
			}
		}

		const newResponse = [];

		for(const [groupRowValue, row] of rows) {

			const newRow = {};

			newRow[groupRow] = groupRowValue;

			for(const [groupColumnValue, values] of row) {

				let
					value = null,
					function_ = null;

				if(groupColumn)
					function_ = this.values[0].function;

				else {

					for(const value of this.values) {
						if(value.column == groupColumnValue)
							function_ = value.function;
					}
				}

				switch(function_) {

					case 'sum':
						value = values.reduce((sum, value) => sum += parseFloat(value), 0);
						break;

					case 'count':
						value = values.length;
						break;

					case 'distinctcount':
						value = new Set(values).size;
						break;

					case 'max':
						value = Math.max(...values);
						break;

					case 'min':
						value = Math.min(...values);
						break;

					case 'average':
						value = Math.floor(values.reduce((sum, value) => sum += parseFloat(value), 0) / values.length * 100) / 100;
						break;

					case 'values':
						value = values.join(', ');
						break;

					case 'distinctvalues':
						value = Array.from(new Set(values)).join(', ');
						break;

					default:
						value = values.length;
				}

				newRow[groupColumnValue] = value;
			}

			newResponse.push(newRow);
		}

		return newResponse;
	}
}

DataSourcePostProcessors.processors = new Map;

DataSourcePostProcessors.processors.set('Orignal', class extends DataSourcePostProcessor {

	get name() {
		return 'No Filter';
	}

	get domain() {
		return new Map();
	}

	processor(response) {
		return response;
	}
});

DataSourcePostProcessors.processors.set('Weekday', class extends DataSourcePostProcessor {

	get name() {
		return 'Weekday';
	}

	get domain() {
		return new Map([
			[0, 'Sunday'],
			[1, 'Monday'],
			[2, 'Tuesday'],
			[3, 'Wednesday'],
			[4, 'Thursday'],
			[5, 'Friday'],
			[6, 'Saturday'],
		]);
	}

	processor(response) {
		return response.filter(r => new Date(r.get('timing')).getDay() == this.container.value)
	}
});

DataSourcePostProcessors.processors.set('CollapseTo', class extends DataSourcePostProcessor {

	get name() {
		return 'Collapse To';
	}

	get domain() {

		return new Map([
			['week', 'Week'],
			['month', 'Month'],
		]);
	}

	processor(response) {

		const result = new Map;

		for(const row of response) {

			let period;

			const periodDate = new Date(row.get('timing'));

			// Week starts from monday, not sunday
			if(this.container.value == 'week')
				period = periodDate.getDay() ? periodDate.getDay() - 1 : 6;

			else if(this.container.value == 'month')
				period = periodDate.getDate() - 1;

			const timing = new Date(Date.parse(row.get('timing')) - period * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

			if(!result.has(timing)) {

				result.set(timing, new DataSourceRow(null, this.source));

				let newRow = result.get(timing);

				for(const key of row.keys())
					newRow.set(key, 0);
			}

			const newRow = result.get(timing);

			for(const [key, value] of row) {

				if(!isNaN(value))
					newRow.set(key, newRow.get(key) + parseFloat(value));

				else newRow.set(key, value);
			}

			newRow.set('timing', row.get('timing'));

			// Copy over any annotations from the old row
			for(const annotation of row.annotations) {
				annotation.row = newRow;
				newRow.annotations.add(annotation);
			}
		}

		return Array.from(result.values());
	}
});

DataSourcePostProcessors.processors.set('RollingAverage', class extends DataSourcePostProcessor {

	get name() {
		return 'Rolling Average';
	}

	get domain() {

		return new Map([
			[7, '7 Days'],
			[14, '14 Days'],
			[30, '30 Days'],
		]);
	}

	processor(response) {

		const
			result = new Map,
			copy = new Map;

		for(const row of response)
			copy.set(Date.parse(row.get('timing')), row);

		for(const [timing, row] of copy) {

			if(!result.has(timing)) {

				result.set(timing, new DataSourceRow(null, this.source));

				let newRow = result.get(timing);

				for(const key of row.keys())
					newRow.set(key, 0);
			}

			const newRow = result.get(timing);

			for(let i = 0; i < this.container.value; i++) {

				const element = copy.get(timing - i * 24 * 60 * 60 * 1000);

				if(!element)
					continue;

				for(const [key, value] of newRow)
					newRow.set(key,  value + (element.get(key) / this.container.value));
			}

			newRow.set('timing', row.get('timing'));

			// Copy over any annotations from the old row
			for(const annotation of row.annotations) {
				annotation.row = newRow;
				newRow.annotations.add(annotation);
			}
		}

		return Array.from(result.values());
	}
});

DataSourcePostProcessors.processors.set('RollingSum', class extends DataSourcePostProcessor {

	get name() {
		return 'Rolling Sum';
	}

	get domain() {

		return new Map([
			[7, '7 Days'],
			[14, '14 Days'],
			[30, '30 Days'],
		]);
	}

	processor(response) {

		const
			result = new Map,
			copy = new Map;

		for(const row of response)
			copy.set(Date.parse(row.get('timing')), row);

		for(const [timing, row] of copy) {

			if(!result.has(timing)) {

				result.set(timing, new DataSourceRow(null, this.source));

				let newRow = result.get(timing);

				for(const key of row.keys())
					newRow.set(key, 0);
			}

			const newRow = result.get(timing);

			for(let i = 0; i < this.container.value; i++) {

				const element = copy.get(timing - i * 24 * 60 * 60 * 1000);

				if(!element)
					continue;

				for(const [key, value] of newRow)
					newRow.set(key,  value + element.get(key));
			}

			newRow.set('timing', row.get('timing'));

			// Copy over any annotations from the old row
			for(const annotation of row.annotations) {
				annotation.row = newRow;
				newRow.annotations.add(annotation);
			}
		}

		return Array.from(result.values());
	}
});

class Visualization {

	constructor(visualization, source) {

		for(const key in visualization)
			this[key] = visualization[key];

		this.id = Math.floor(Math.random() * 100000);

		this.source = source;

		try {
			this.options = JSON.parse(this.options);
		} catch(e) {}

		for(const key in this.options)
			this[key] = this.options[key];
	}

	render() {

		const visualizationToggle = this.source.container.querySelector('header .change-visualization');

		if(visualizationToggle)
			visualizationToggle.value = this.source.visualizations.indexOf(this);

		this.source.container.removeChild(this.source.container.querySelector('.visualization'));

		this.source.visualizations.selected = this;

		this.source.container.appendChild(this.container);

		const configure = this.source.container.querySelector('.configure-visualization');

		if(configure) {

			if(this.visualization_id)
				configure.href = `/visualization/${this.visualization_id}`;

			configure.classList.toggle('hidden', !this.visualization_id);
		}

		this.source.resetError();
	}
}

class LinearVisualization extends Visualization {

	constructor(visualization, source) {

		super(visualization, source);

		for(const axis of this.axes || []) {
			this.axes[axis.position] = axis;
			axis.column = axis.columns.length ? axis.columns[0].key : '';
		}
	}

	draw() {

		if(!this.source.response || !this.source.response.length)
			return this.source.error('No data found! :(');

		if(!this.axes)
			return this.source.error('Axes not defined! :(');

		if(!this.axes.bottom)
			return this.source.error('Bottom axis not defined! :(');

		if(!this.axes.left)
			return this.source.error('Left axis not defined! :(');

		if(!this.axes.bottom.columns.length)
			return this.source.error('Bottom axis requires exactly one column! :(');

		if(!this.axes.left.columns.length)
			return this.source.error('Left axis requires atleast one column! :(');

		if(this.axes.bottom.columns.length > 1)
			return this.source.error('Bottom axis cannot has more than one column! :(');

		for(const column of this.axes.bottom.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Bottom axis column <em>${column.key}</em> not found! :(`);
		}

		for(const column of this.axes.left.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Left axis column <em>${column.key}</em> not found! :(`);
		}

		for(const bottom of this.axes.bottom.columns) {
			for(const left of this.axes.left.columns) {

				if(bottom.key == left.key)
					return this.source.error(`Column <em>${bottom.key}</em> cannot be on both axis! :(`);
			}
		}

		for(const [key, column] of this.source.columns) {

			if(this.axes.left.columns.some(c => c.key == key) || (this.axes.right && this.axes.right.columns.some(c => c.key == key)) || this.axes.bottom.columns.some(c => c.key == key))
				continue;

			column.disabled = true;
			column.render();
		}

		this.rows = this.source.response;

		this.axes.bottom.height = 25;
		this.axes.left.width = 50;

		if(this.axes.bottom.label)
			this.axes.bottom.height += 20;

		if(this.axes.left.label)
			this.axes.left.width += 20;

		this.height = this.container.clientHeight - this.axes.bottom.height - 20;
		this.width = this.container.clientWidth - this.axes.left.width - 40;

		window.addEventListener('resize', () => {

			const
				height = this.container.clientHeight - this.axes.bottom.height - 20,
				width = this.container.clientWidth - this.axes.left.width - 40;

			if(this.width != width || this.height != height) {

				this.width = width;
				this.height = height;

				this.plot(true);
			}
		});
	}

	plot() {

		const container = d3.selectAll(`#visualization-${this.id}`);

		container.selectAll('*').remove();

		if(!this.rows)
			return;

		this.columns = {};

		for(const row of this.rows) {

			for(const [key, value] of row) {

				if(key == this.axes.bottom.column)
					continue;

				const column = this.source.columns.get(key);

				if(!column)
					continue;

				if(!this.columns[key]) {
					this.columns[key] = [];
					Object.assign(this.columns[key], column);
				}

				this.columns[key].push({
					x: row.get(this.axes.bottom.column),
					y: value,
					y1: this.axes.right ? row.get(this.axes.right.column) : null,
					key,
				});
			}
		}

		this.columns = Object.values(this.columns);

		this.svg = container
			.append('svg')
			.append('g')
			.attr('class', 'chart');

		if(!this.rows.length) {

			return this.svg
				.append('g')
				.append('text')
				.attr('x', (this.width / 2))
				.attr('y', (this.height / 2))
				.attr('text-anchor', 'middle')
				.attr('class', 'NA')
				.attr('fill', '#999')
				.text(this.source.originalResponse.message || 'No data found! :(');
		}

		if(this.rows.length != this.source.response.length) {

			// Reset Zoom Button
			const resetZoom = this.svg.append('g')
				.attr('class', 'reset-zoom')
				.attr('y', 0)
				.attr('x', (this.width / 2) - 35);

			resetZoom.append('rect')
				.attr('width', 80)
				.attr('height', 20)
				.attr('y', 0)
				.attr('x', (this.width / 2) - 35);

			resetZoom.append('text')
				.attr('y', 15)
				.attr('x', (this.width / 2) - 35 + 40)
				.attr('text-anchor', 'middle')
				.style('font-size', '12px')
				.text('Reset Zoom');

			// Click on reset zoom function
			resetZoom.on('click', () => {
				this.rows = this.source.response;
				this.plot();
			});
		}

		const that = this;

		this.zoomRectangle = null;

		container

		.on('mousemove', function() {

			const mouse = d3.mouse(this);

			if(that.zoomRectangle) {

				const
					filteredRows = that.rows.filter(row => {

						const item = that.x(row.get(that.axes.bottom.column)) + 100;

						if(mouse[0] < that.zoomRectangle.origin[0])
							return item >= mouse[0] && item <= that.zoomRectangle.origin[0];
						else
							return item <= mouse[0] && item >= that.zoomRectangle.origin[0];
					}),
					width = Math.abs(mouse[0] - that.zoomRectangle.origin[0]);

				// Assign width and height to the rectangle
				that.zoomRectangle
					.select('rect')
					.attr('x', Math.min(that.zoomRectangle.origin[0], mouse[0]))
					.attr('width', width)
					.attr('height', that.height);

				that.zoomRectangle
					.select('g')
					.selectAll('*')
					.remove();

				that.zoomRectangle
					.select('g')
					.append('text')
					.text(`${Format.number(filteredRows.length)} Selected`)
					.attr('x', Math.min(that.zoomRectangle.origin[0], mouse[0]) + (width / 2))
					.attr('y', (that.height / 2) - 5);

				if(filteredRows.length) {

					that.zoomRectangle
						.select('g')
						.append('text')
						.text(`${filteredRows[0].get(that.axes.bottom.column)} - ${filteredRows[filteredRows.length - 1].get(that.axes.bottom.column)}`)
						.attr('x', Math.min(that.zoomRectangle.origin[0], mouse[0]) + (width / 2))
						.attr('y', (that.height / 2) + 20);
				}

				return;
			}

			const row = that.rows[parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length))];

			if(!row)
				return;

			const tooltip = [];

			for(const [key, value] of row) {

				if(key == that.axes.bottom.column)
					continue;

				const column = row.source.columns.get(key);

				tooltip.push(`
					<li class="${row.size > 2 && that.hoverColumn && that.hoverColumn.key == key ? 'hover' : ''}">
						<span class="circle" style="background:${column.color}"></span>
						<span>
							${column.drilldown && column.drilldown.query_id ? '<i class="fas fa-angle-double-down"></i>' : ''}
							${column.name}
						</span>
						<span class="value">${Format.number(value)}</span>
					</li>
				`);
			}

			const content = `
				<header>${row.get(that.axes.bottom.column)}</header>
				<ul class="body">
					${tooltip.reverse().join('')}
				</ul>
			`;

			Tooltip.show(that.container, mouse, content, row);
		})

		.on('mouseleave', function() {
			Tooltip.hide(that.container);
		})

		.on('mousedown', function() {

			Tooltip.hide(that.container);

			if(that.zoomRectangle)
				return;

			that.zoomRectangle = container.select('svg').append('g');

			that.zoomRectangle
				.attr('class', 'zoom')
				.style('text-anchor', 'middle')
				.append('rect')
				.attr('class', 'zoom-rectangle');

			that.zoomRectangle
				.append('g');

			that.zoomRectangle.origin = d3.mouse(this);
		})

		.on('mouseup', function() {

			if(!that.zoomRectangle)
				return;

			that.zoomRectangle.remove();

			const
				mouse = d3.mouse(this),
				filteredRows = that.rows.filter(row => {

					const item = that.x(row.get(that.axes.bottom.column)) + 100;

					if(mouse[0] < that.zoomRectangle.origin[0])
						return item >= mouse[0] && item <= that.zoomRectangle.origin[0];
					else
						return item <= mouse[0] && item >= that.zoomRectangle.origin[0];
				});

			that.zoomRectangle = null;

			if(!filteredRows.length)
				return;

			that.rows = filteredRows;

			that.plot();
		}, true);
	}
}

Visualization.list = new Map;

Visualization.list.set('table', class Table extends Visualization {

	constructor(visualization, source) {

		super(visualization, source);

		this.rowLimit = 15;
		this.rowLimitMultiplier = 1.75;
	}

	async load(e) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `
			<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
		`;

		await this.source.fetch();

		this.render();
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('section');

		container.classList.add('visualization', 'table');

		container.innerHTML = `
			<div class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	render() {

		const
			container = this.container.querySelector('.container'),
			rows = this.source.response;

		container.textContent = null;

		const
			table = document.createElement('table'),
			thead = document.createElement('thead'),
			search = document.createElement('tr'),
			accumulation = document.createElement('tr'),
			headings = document.createElement('tr'),
			rowCount = document.createElement('div');

		search.classList.add('search');
		accumulation.classList.add('accumulation');

		for(const column of this.source.columns.list.values()) {

			search.appendChild(column.search);
			accumulation.appendChild(column.accumulation);
			headings.appendChild(column.heading);
		}

		thead.appendChild(search);
		thead.appendChild(accumulation);
		thead.appendChild(headings);
		table.appendChild(thead);

		const tbody = document.createElement('tbody');

		for(const [position, row] of rows.entries()) {

			if(position >= this.rowLimit)
				break;

			const tr = document.createElement('tr');

			for(const [key, column] of this.source.columns.list) {

				const td = document.createElement('td');

				td.textContent = row.get(key);

				if(column.drilldown && column.drilldown.query_id) {

					td.classList.add('drilldown');
					td.on('click', () => column.initiateDrilldown(row));

					td.title = `Drill down into ${DataSource.list.get(column.drilldown.query_id).name}!`;
				}

				tr.appendChild(td);
			}

			tr.on('click', () => tr.classList.toggle('selected'));

			tbody.appendChild(tr);
		}

		if(rows.length > this.rowLimit) {

			const tr = document.createElement('tr');

			tr.classList.add('show-rows');

			tr.innerHTML = `
				<td colspan="${this.source.columns.list.size}">
					<i class="fa fa-angle-down"></i>
					<span>Show ${parseInt(Math.ceil(this.rowLimit * this.rowLimitMultiplier) - this.rowLimit)} more rows</span>
					<i class="fa fa-angle-down"></i>
				</td>
			`;

			tr.on('click', () => {
				this.rowLimit = Math.ceil(this.rowLimit * this.rowLimitMultiplier);
				this.source.visualizations.selected.render();
			});

			tbody.appendChild(tr);
		}

		if(!rows || !rows.length) {
			table.insertAdjacentHTML('beforeend', `
				<tr class="NA"><td colspan="${this.source.columns.size}">${this.source.originalResponse.message || 'No data found! :('}</td></tr>
			`);
		}

		rowCount.classList.add('row-count');

		rowCount.innerHTML = `
			<span>
				<span class="label">Showing:</span>
				<strong title="Number of rows currently shown on screen">
					${Format.number(Math.min(this.rowLimit, rows.length))}
				</strong>
			</span>
			<span>
				<span class="label">Filtered:</span>
				<strong title="Number of rows that match any search or grouping criterion">
					${Format.number(rows.length)}
				</strong>
			</span>
			<span>
				<span class="label">Total:</span>
				<strong title="Total number of rows in the dataset">
					${Format.number(this.source.originalResponse.data ? this.source.originalResponse.data.length : 0)}
				</strong>
			</span>
		`;

		table.appendChild(tbody);
		container.appendChild(table);
		container.appendChild(rowCount);
	}
});

Visualization.list.set('line', class Line extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'line');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e, resize) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.render(resize);
	}

	render(resize) {

		this.draw();

		this.plot(resize);
	}

	plot(resize) {

		super.plot(resize);

		if(!this.rows || !this.rows.length)
			return;

		const
			container = d3.selectAll(`#visualization-${this.id}`),
			that = this;

		this.x = d3.scale.ordinal();
		this.y = d3.scale.linear().range([this.height, 20]);

		const
			xAxis = d3.svg.axis()
				.scale(this.x)
				.orient('bottom'),

			yAxis = d3.svg.axis()
				.scale(this.y)
				.innerTickSize(-this.width)
				.orient('left');

		let
			max = null,
			min = null;

		for(const row of this.rows) {

			for(const [name, value] of row) {

				if(name == this.axes.bottom.column)
					continue;

				if(max == null)
					max = Math.floor(value);

				if(min == null)
					min = Math.floor(value);

				max = Math.max(max, Math.floor(value) || 0);
				min = Math.min(min, Math.floor(value) || 0);
			}
		}

		this.y.domain([min, max]);
		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangePoints([0, this.width], 0.1, 0);

		const
			tickNumber = this.width < 400 ? 3 : 5,
			tickInterval = parseInt(this.x.domain().length / tickNumber),
			ticks = this.x.domain().filter((d, i) => !(i % tickInterval));

		xAxis.tickValues(ticks);

		this.svg
			.append('g')
			.attr('class', 'y axis')
			.call(yAxis)
			.attr('transform', `translate(${this.axes.left.width}, 0)`);

		this.svg
			.append('g')
			.attr('class', 'x axis')
			.attr('transform', `translate(${this.axes.left.width}, ${this.height})`)
			.call(xAxis);

		this.svg
			.append('text')
			.attr('transform', `translate(${(this.width / 2)}, ${this.height + 40})`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.bottom.label);

		this.svg
			.append('text')
			.attr('transform', `rotate(-90) translate(${(this.height / 2 * -1)}, 12)`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.left.label);

		//graph type line and
		const
			line = d3.svg
				.line()
				.x(d => this.x(d.x)  + this.axes.left.width)
				.y(d => this.y(d.y));

		//Appending line in chart
		this.svg.selectAll('.city')
			.data(this.columns)
			.enter()
			.append('g')
			.attr('class', 'city')
			.append('path')
			.attr('class', 'line')
			.attr('d', d => line(d))
			.style('stroke', d => d.color);

		// Selecting all the paths
		const path = this.svg.selectAll('path');

		if(!resize) {
			path[0].forEach(path => {
				var length = path.getTotalLength();

				path.style.strokeDasharray = length + ' ' + length;
				path.style.strokeDashoffset = length;
				path.getBoundingClientRect();

				path.style.transition  = `stroke-dashoffset ${Visualization.animationDuration}ms ease-in-out`;
				path.style.strokeDashoffset = '0';
			});
		}

		// For each line appending the circle at each point
		for(const column of this.columns) {

			this.svg.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'clips')
				.attr('id', (_, i) => i)
				.attr('r', 0)
				.style('fill', column.color)
				.attr('cx', d => this.x(d.x) + this.axes.left.width)
				.attr('cy', d => this.y(d.y))
		}

		container
		.on('mousemove.line', function() {

			container.selectAll('svg > g > circle[class="clips"]').attr('r', 0);

			const
				mouse = d3.mouse(this),
				xpos = parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length)),
				row = that.rows[xpos];

			if(!row || that.zoomRectangle)
				return;

			container.selectAll(`svg > g > circle[id='${xpos}'][class="clips"]`).attr('r', 6);
		})

		.on('mouseout.line', () => container.selectAll('svg > g > circle[class="clips"]').attr('r', 0));

		path.on('mouseover', function (d) {
			d3.select(this).classed('line-hover', true);
		});

		path.on('mouseout', function (d) {
			d3.select(this).classed('line-hover', false);
		});
	}
});

Visualization.list.set('bubble', class Line extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'bubble');

		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e, resize) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.render(resize);
	}

	render(resize) {

		this.draw();

		this.plot(resize);
	}

	plot(resize) {

		super.plot(resize);

		if(!this.rows || !this.rows.length)
			return;

		const
			container = d3.selectAll(`#visualization-${this.id}`),
			that = this;

		this.x = d3.scale.ordinal();
		this.y = d3.scale.linear().range([this.height, 20]);
		this.bubble = d3.scale.linear().range([0, 50]);

		const
			xAxis = d3.svg.axis()
				.scale(this.x)
				.orient('bottom'),

			yAxis = d3.svg.axis()
				.scale(this.y)
				.innerTickSize(-this.width)
				.orient('left');

		this.y.max = 0;
		this.y.min = 0;
		this.bubble.max = 0;
		this.bubble.min = 0;

		for(const row of this.rows) {

			for(const [key, value] of row) {

				if(this.axes.left.columns.some(c => c.key == key)) {
					this.y.max = Math.max(this.y.max, Math.ceil(value) || 0);
					this.y.min = Math.min(this.y.min, Math.ceil(value) || 0);
				}

				if(this.axes.right.columns.some(c => c.key == key)) {
					this.bubble.max = Math.max(this.bubble.max, Math.ceil(value) || 0);
					this.bubble.min = Math.min(this.bubble.min, Math.ceil(value) || 0);
				}
			}
		}

		this.y.domain([this.y.min, this.y.max]);
		this.bubble.domain([this.bubble.min, this.bubble.max]);

		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangePoints([0, this.width], 0.1, 0);

		const
			tickNumber = this.width < 400 ? 3 : 5,
			tickInterval = parseInt(this.x.domain().length / tickNumber),
			ticks = this.x.domain().filter((d, i) => !(i % tickInterval));

		xAxis.tickValues(ticks);

		this.svg
			.append('g')
			.attr('class', 'y axis')
			.call(yAxis)
			.attr('transform', `translate(${this.axes.left.width}, 0)`);

		this.svg
			.append('g')
			.attr('class', 'x axis')
			.attr('transform', `translate(${this.axes.left.width}, ${this.height})`)
			.call(xAxis);

		this.svg
			.append('text')
			.attr('transform', `translate(${(this.width / 2)}, ${this.height + 40})`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.bottom.label);

		this.svg
			.append('text')
			.attr('transform', `rotate(-90) translate(${(this.height / 2 * -1)}, 12)`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.left.label);

		//graph type line and
		const
			line = d3.svg
				.line()
				.x(d => this.x(d.x)  + this.axes.left.width)
				.y(d => this.y(d.y));

		// For each line appending the circle at each point
		for(const column of this.columns) {

			this.svg.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'clips')
				.attr('id', (_, i) => i)
				.attr('r', d => this.bubble(d.y1))
				.style('fill', column.color)
				.attr('cx', d => this.x(d.x) + this.axes.left.width)
				.attr('cy', d => this.y(d.y))
		}

		container
		.on('mousemove.line', function() {

			// container.selectAll('svg > g > circle[class="clips"]').attr('r', 3);

			const
				mouse = d3.mouse(this),
				xpos = parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length)),
				row = that.rows[xpos];

			if(!row || that.zoomRectangle)
				return;

			// container.selectAll(`svg > g > circle[id='${xpos}'][class="clips"]`).attr('r', 6);
		})

		// .on('mouseout.line', () => container.selectAll('svg > g > circle[class="clips"]').attr('r', 3));
	}
});

Visualization.list.set('scatter', class Line extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'scatter');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e, resize) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.render(resize);
	}

	render(resize) {

		this.draw();

		this.plot(resize);
	}

	plot(resize) {

		super.plot(resize);

		if(!this.rows || !this.rows.length)
			return;

		const
			container = d3.selectAll(`#visualization-${this.id}`),
			that = this;

		this.x = d3.scale.ordinal();
		this.y = d3.scale.linear().range([this.height, 20]);

		const
			xAxis = d3.svg.axis()
				.scale(this.x)
				.orient('bottom'),

			yAxis = d3.svg.axis()
				.scale(this.y)
				.innerTickSize(-this.width)
				.orient('left');

		let
			max = null,
			min = null;

		for(const row of this.rows) {

			for(const [name, value] of row) {

				if(name == this.axes.bottom.column)
					continue;

				if(max == null)
					max = Math.floor(value);

				if(min == null)
					min = Math.floor(value);

				max = Math.max(max, Math.floor(value) || 0);
				min = Math.min(min, Math.floor(value) || 0);
			}
		}

		this.y.domain([min, max]);
		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangePoints([0, this.width], 0.1, 0);

		const
			tickNumber = this.width < 400 ? 3 : 5,
			tickInterval = parseInt(this.x.domain().length / tickNumber),
			ticks = this.x.domain().filter((d, i) => !(i % tickInterval));

		xAxis.tickValues(ticks);

		this.svg
			.append('g')
			.attr('class', 'y axis')
			.call(yAxis)
			.attr('transform', `translate(${this.axes.left.width}, 0)`);

		this.svg
			.append('g')
			.attr('class', 'x axis')
			.attr('transform', `translate(${this.axes.left.width}, ${this.height})`)
			.call(xAxis);

		this.svg
			.append('text')
			.attr('transform', `translate(${(this.width / 2)}, ${this.height + 40})`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.bottom.label);

		this.svg
			.append('text')
			.attr('transform', `rotate(-90) translate(${(this.height / 2 * -1)}, 12)`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.left.label);

		//graph type line and
		const
			line = d3.svg
				.line()
				.x(d => this.x(d.x)  + this.axes.left.width)
				.y(d => this.y(d.y));

		// For each line appending the circle at each point
		for(const column of this.columns) {

			this.svg.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'clips')
				.attr('id', (_, i) => i)
				.attr('r', 3)
				.style('fill', column.color)
				.attr('cx', d => this.x(d.x) + this.axes.left.width)
				.attr('cy', d => this.y(d.y))
		}

		container
		.on('mousemove.line', function() {

			container.selectAll('svg > g > circle[class="clips"]').attr('r', 3);

			const
				mouse = d3.mouse(this),
				xpos = parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length)),
				row = that.rows[xpos];

			if(!row || that.zoomRectangle)
				return;

			container.selectAll(`svg > g > circle[id='${xpos}'][class="clips"]`).attr('r', 6);
		})

		.on('mouseout.line', () => container.selectAll('svg > g > circle[class="clips"]').attr('r', 3));
	}
});

Visualization.list.set('bar', class Bar extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'bar');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.source.response;

		this.render();
	}

	render(resize) {

		this.draw();
		this.plot(resize);
	}

	plot(resize)  {

		super.plot(resize);

		if(!this.rows || !this.rows.length)
			return;

		const that = this;

		this.x = d3.scale.ordinal();
		this.y = d3.scale.linear().range([this.height, 20]);

		const
			x1 = d3.scale.ordinal(),
			xAxis = d3.svg.axis()
				.scale(this.x)
				.orient('bottom'),

			yAxis = d3.svg.axis()
				.scale(this.y)
				.innerTickSize(-this.width)
				.orient('left');

		let
			max = 0,
			min = 0;

		for(const row of this.rows) {

			for(const [key, value] of row) {

				if(!this.axes.left.columns.some(c => c.key == key))
					continue;

				max = Math.max(max, Math.ceil(value) || 0);
				min = Math.min(min, Math.ceil(value) || 0);
			}
		}

		this.y.domain([min, max]);

		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangeBands([0, this.width], 0.1, 0);

		const
			tickNumber = this.width < 400 ? 3 : 5,
			tickInterval = parseInt(this.x.domain().length / tickNumber),
			ticks = this.x.domain().filter((d, i) => !(i % tickInterval));

		xAxis.tickValues(ticks);

		x1.domain(this.columns.map(c => c.name)).rangeBands([0, this.x.rangeBand()]);

		this.svg
			.append('g')
			.attr('class', 'y axis')
			.call(yAxis)
			.attr('transform', `translate(${this.axes.left.width}, 0)`);

		this.svg
			.append('g')
			.attr('class', 'x axis')
			.attr('transform', `translate(${this.axes.left.width}, ${this.height})`)
			.call(xAxis);

		this.svg
			.append('text')
			.attr('transform', `translate(${(this.width / 2)}, ${this.height + 40})`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.bottom.label);

		this.svg
			.append('text')
			.attr('transform', `rotate(-90) translate(${(this.height / 2 * -1)}, 12)`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.left.label);

		let bars = this.svg
			.append('g')
			.selectAll('g')
			.data(this.columns)
			.enter()
			.append('g')
			.style('fill', column => column.color)
			.attr('transform', column => `translate(${x1(column.name)}, 0)`)
			.selectAll('rect')
			.data(column => column)
			.enter()
			.append('rect')
			.classed('bar', true)
			.attr('width', x1.rangeBand())
			.attr('x', cell => this.x(cell.x) + this.axes.left.width)
			.on('click', function(_, row, column) {
				that.source.columns.get(that.columns[column].key).initiateDrilldown(that.rows[row]);
				d3.select(this).classed('hover', false);
			})
			.on('mouseover', function(_, __, column) {
				that.hoverColumn = that.columns[column];
				d3.select(this).classed('hover', true);
			})
			.on('mouseout', function() {
				that.hoverColumn = null;
				d3.select(this).classed('hover', false);
			});

		if(!resize) {

			bars = bars
				.attr('y', cell => this.y(0))
				.attr('height', () => 0)
				.transition()
				.duration(Visualization.animationDuration)
				.ease('quad-in');
		}

		bars
			.attr('y', cell => this.y(cell.y > 0 ? cell.y : 0))
			.attr('height', cell => Math.abs(this.y(cell.y) - this.y(0)));
	}
});

Visualization.list.set('dualaxisbar', class DualAxisBar extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'dualaxisbar');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.render();
	}

	constructor(visualization, source) {

		super(visualization, source);

		for(const axis of this.axes || []) {
			this.axes[axis.position] = axis;
			axis.column = axis.columns.length ? axis.columns[0].key : '';
		}
	}

	draw() {

		if(!this.axes)
			return this.source.error('Axes not defined! :(');

		if(!this.axes.bottom)
			return this.source.error('Bottom axis not defined! :(');

		if(!this.axes.left)
			return this.source.error('Left axis not defined! :(');

		if(!this.axes.right)
			return this.source.error('Right axis not defined! :(');

		if(!this.axes.bottom.columns.length)
			return this.source.error('Bottom axis requires exactly one column! :(');

		if(!this.axes.left.columns.length)
			return this.source.error('Left axis requires atleast one column! :(');

		if(!this.axes.right.columns.length)
			return this.source.error('Right axis requires atleast one column! :(');

		if(this.axes.bottom.columns.length > 1)
			return this.source.error('Bottom axis cannot has more than one column! :(');

		for(const column of this.axes.bottom.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Bottom axis column <em>${column.key}</em> not found! :()`);
		}

		for(const column of this.axes.left.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Left axis column <em>${column.key}</em> not found! :(`);
		}

		for(const column of this.axes.right.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Right axis column <em>${column.key}</em> not found! :(`);
		}

		for(const bottom of this.axes.bottom.columns) {

			for(const left of this.axes.left.columns) {

				if(bottom.key == left.key)
					return this.source.error(`Column <em>${bottom.key}</em> cannot be on two axis! :(`);
			}

			for(const right of this.axes.right.columns) {

				if(bottom.key == right.key)
					return this.source.error(`Column <em>${bottom.key}</em> cannot be on two axis! :(`);
			}
		}

		for(const [key, column] of this.source.columns) {

			if(this.axes.left.columns.some(c => c.key == key) || this.axes.right.columns.some(c => c.key == key) || this.axes.bottom.columns.some(c => c.key == key))
				continue;

			column.disabled = true;
			column.render();
		}

		this.rows = this.source.response;

		if(!this.rows || !this.rows.length)
			return;

		this.axes.bottom.height = 25;
		this.axes.left.width = 40;
		this.axes.right.width = 25;

		if(this.axes.bottom.label)
			this.axes.bottom.height += 20;

		if(this.axes.left.label)
			this.axes.left.width += 20;

		if(this.axes.right.label)
			this.axes.right.width += 10;

		this.height = this.container.clientHeight - this.axes.bottom.height - 20;
		this.width = this.container.clientWidth - this.axes.left.width - this.axes.right.width - 40;

		window.addEventListener('resize', () => {

			const
				height = this.container.clientHeight - this.axes.bottom.height - 20,
				width = this.container.clientWidth - this.axes.left.width - this.axes.right.width - 40;

			if(this.width != width || this.height != height) {

				this.width = width;
				this.height = height;

				this.plot(true);
			}
		});
	}

	render(resize) {

		this.draw();
		this.plot(resize);
	}

	plot(resize)  {

		const container = d3.selectAll(`#visualization-${this.id}`);

		container.selectAll('*').remove();

		this.columns = {
			left: {},
			right: {},
		};

		for(const row of this.rows) {

			for(const [key, value] of row) {

				if(key == this.axes.bottom.column)
					continue;

				const column = this.source.columns.get(key);

				if(!column)
					continue;

				let direction = null;

				if(this.axes.left.columns.some(c => c.key == key))
					direction = 'left';

				if(this.axes.right.columns.some(c => c.key == key))
					direction = 'right';

				if(!direction)
					continue;

				if(!this.columns[direction][key]) {
					this.columns[direction][key] = [];
					Object.assign(this.columns[direction][key], column);
				}

				this.columns[direction][key].push({
					x: row.get(this.axes.bottom.column),
					y: value,
					key,
				});
			}
		}

		this.columns.left = Object.values(this.columns.left);
		this.columns.right = Object.values(this.columns.right);

		this.svg = container
			.append('svg')
			.append('g')
			.attr('class', 'chart');

		if(!this.rows.length) {

			return this.svg
				.append('g')
				.append('text')
				.attr('x', (this.width / 2))
				.attr('y', (this.height / 2))
				.attr('text-anchor', 'middle')
				.attr('class', 'NA')
				.attr('fill', '#999')
				.text(this.source.originalResponse.message || 'No data found! :(');
		}

		if(this.rows.length != this.source.response.length) {

			// Reset Zoom Button
			const resetZoom = this.svg.append('g')
				.attr('class', 'reset-zoom')
				.attr('y', 0)
				.attr('x', (this.width / 2) - 35);

			resetZoom.append('rect')
				.attr('width', 80)
				.attr('height', 20)
				.attr('y', 0)
				.attr('x', (this.width / 2) - 35);

			resetZoom.append('text')
				.attr('y', 15)
				.attr('x', (this.width / 2) - 35 + 40)
				.attr('text-anchor', 'middle')
				.style('font-size', '12px')
				.text('Reset Zoom');

			// Click on reset zoom function
			resetZoom.on('click', () => {
				this.rows = this.source.response;
				this.plot();
			});
		}

		if(!this.rows.length)
			return;

		const that = this;

		this.bottom = d3.scale.ordinal();
		this.left = d3.scale.linear().range([this.height, 20]);
		this.right = d3.scale.linear().range([this.height, 20]);

		const
			x1 = d3.scale.ordinal(),
			bottomAxis = d3.svg.axis()
				.scale(this.bottom)
				.orient('bottom'),

			leftAxis = d3.svg.axis()
				.scale(this.left)
				.innerTickSize(-this.width)
			    .tickFormat(d3.format('s'))
				.orient('left'),

			rightAxis = d3.svg.axis()
				.scale(this.right)
				.innerTickSize(this.width)
			    .tickFormat(d3.format('s'))
				.orient('right');

		this.left.max = 0;
		this.right.max = 0;

		for(const row of this.rows) {

			for(const [key, value] of row) {

				if(this.axes.left.columns.some(c => c.key == key))
					this.left.max = Math.max(this.left.max, Math.ceil(value) || 0);

				if(this.axes.right.columns.some(c => c.key == key))
					this.right.max = Math.max(this.right.max, Math.ceil(value) || 0);
			}
		}

		this.left.domain([0, this.left.max]);
		this.right.domain([0, this.right.max]);

		this.bottom.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.bottom.rangeBands([0, this.width], 0.1, 0);

		const
			tickNumber = this.width < 400 ? 3 : 5,
			tickInterval = parseInt(this.bottom.domain().length / tickNumber),
			ticks = this.bottom.domain().filter((d, i) => !(i % tickInterval));

		bottomAxis.tickValues(ticks);

		x1.domain(this.columns.left.map(c => c.name)).rangeBands([0, this.bottom.rangeBand()]);

		this.svg
			.append('g')
			.attr('class', 'x axis')
			.attr('transform', `translate(${this.axes.left.width}, ${this.height})`)
			.call(bottomAxis);

		this.svg
			.append('g')
			.attr('class', 'y axis')
			.call(leftAxis)
			.attr('transform', `translate(${this.axes.left.width}, 0)`);

		this.svg
			.append('g')
			.attr('class', 'y axis')
			.call(rightAxis)
			.attr('transform', `translate(${this.axes.left.width}, 0)`);

		this.svg
			.append('text')
			.attr('transform', `translate(${(this.width / 2)}, ${this.height + 40})`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.bottom.label);

		this.svg
			.append('text')
			.attr('transform', `rotate(-90) translate(${(this.height / 2 * -1)}, 12)`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.left.label);

		this.svg
			.append('text')
			.attr('transform', `rotate(90) translate(${(this.height / 2)}, ${(this.axes.left.width + this.width + 40) * -1})`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.right.label);

		let bars = this.svg
			.append('g')
			.selectAll('g')
			.data(this.columns.left)
			.enter()
			.append('g')
			.style('fill', column => column.color)
			.attr('transform', column => `translate(${x1(column.name)}, 0)`)
			.selectAll('rect')
			.data(column => column)
			.enter()
			.append('rect')
			.classed('bar', true)
			.attr('width', x1.rangeBand())
			.attr('x', cell => this.bottom(cell.x) + this.axes.left.width)
			.on('click', function(_, row, column) {
				that.source.columns.get(that.columns.left[column].key).initiateDrilldown(that.rows[row]);
				d3.select(this).classed('hover', false);
			})
			.on('mouseover', function(_, __, column) {
				that.hoverColumn = that.columns.left[column];
				d3.select(this).classed('hover', true);
			})
			.on('mouseout', function() {
				that.hoverColumn = null;
				d3.select(this).classed('hover', false);
			});

		if(!resize) {

			bars = bars
				.attr('height', () => 0)
				.attr('y', () => this.height)
				.transition()
				.duration(Visualization.animationDuration)
				.ease('quad-in');
		}

		bars
			.attr('height', cell => this.height - this.left(cell.y))
			.attr('y', cell => this.left(cell.y));


		//graph type line and
		const
			line = d3.svg
				.line()
				.x(d => this.bottom(d.x)  + this.axes.left.width + (this.bottom.rangeBand() / 2))
				.y(d => this.right(d.y));

		//Appending line in chart
		this.svg.selectAll('.city')
			.data(this.columns.right)
			.enter()
			.append('g')
			.attr('class', 'city')
			.append('path')
			.attr('class', 'line')
			.attr('d', d => line(d))
			.style('stroke', d => d.color);

		// Selecting all the paths
		const path = this.svg.selectAll('path');

		if(!resize) {
			path[0].forEach(path => {
				var length = path.getTotalLength();

				path.style.strokeDasharray = length + ' ' + length;
				path.style.strokeDashoffset = length;
				path.getBoundingClientRect();

				path.style.transition  = `stroke-dashoffset ${Visualization.animationDuration}ms ease-in-out`;
				path.style.strokeDashoffset = '0';
			});
		}

		// For each line appending the circle at each point
		for(const column of this.columns.right) {

			this.svg.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'clips')
				.attr('id', (_, i) => i)
				.attr('r', 5)
				.style('fill', column.color)
				.attr('cx', d => this.bottom(d.x) + this.axes.left.width + (this.bottom.rangeBand() / 2))
				.attr('cy', d => this.right(d.y))
		}

		this.zoomRectangle = null;

		container

		.on('mousemove', function() {

			const mouse = d3.mouse(this);

			if(that.zoomRectangle) {

				const
					filteredRows = that.rows.filter(row => {

						const item = that.bottom(row.get(that.axes.bottom.column)) + 100;

						if(mouse[0] < that.zoomRectangle.origin[0])
							return item >= mouse[0] && item <= that.zoomRectangle.origin[0];
						else
							return item <= mouse[0] && item >= that.zoomRectangle.origin[0];
					}),
					width = Math.abs(mouse[0] - that.zoomRectangle.origin[0]);

				// Assign width and height to the rectangle
				that.zoomRectangle
					.select('rect')
					.attr('x', Math.min(that.zoomRectangle.origin[0], mouse[0]))
					.attr('width', width)
					.attr('height', that.height);

				that.zoomRectangle
					.select('g')
					.selectAll('*')
					.remove();

				that.zoomRectangle
					.select('g')
					.append('text')
					.text(`${Format.number(filteredRows.length)} Selected`)
					.attr('x', Math.min(that.zoomRectangle.origin[0], mouse[0]) + (width / 2))
					.attr('y', (that.height / 2) - 5);

				if(filteredRows.length) {

					that.zoomRectangle
						.select('g')
						.append('text')
						.text(`${filteredRows[0].get(that.axes.bottom.column)} - ${filteredRows[filteredRows.length - 1].get(that.axes.bottom.column)}`)
						.attr('x', Math.min(that.zoomRectangle.origin[0], mouse[0]) + (width / 2))
						.attr('y', (that.height / 2) + 20);
				}

				return;
			}

			const row = that.rows[parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length))];

			if(!row)
				return;

			const tooltip = [];

			for(const [key, value] of row) {

				if(key == that.axes.bottom.column)
					continue;

				tooltip.push(`
					<li class="${row.size > 2 && that.hoverColumn && that.hoverColumn.key == key ? 'hover' : ''}">
						<span class="circle" style="background:${row.source.columns.get(key).color}"></span>
						<span>${row.source.columns.get(key).name}</span>
						<span class="value">${Format.number(value)}</span>
					</li>
				`);
			}

			const content = `
				<header>${row.get(that.axes.bottom.column)}</header>
				<ul class="body">
					${tooltip.reverse().join('')}
				</ul>
			`;

			Tooltip.show(that.container, mouse, content, row);
		})

		.on('mouseleave', function() {
			Tooltip.hide(that.container);
		})

		.on('mousedown', function() {

			Tooltip.hide(that.container);

			if(that.zoomRectangle)
				return;

			that.zoomRectangle = container.select('svg').append('g');

			that.zoomRectangle
				.attr('class', 'zoom')
				.style('text-anchor', 'middle')
				.append('rect')
				.attr('class', 'zoom-rectangle');

			that.zoomRectangle
				.append('g');

			that.zoomRectangle.origin = d3.mouse(this);
		})

		.on('mouseup', function() {

			if(!that.zoomRectangle)
				return;

			that.zoomRectangle.remove();

			const
				mouse = d3.mouse(this),
				filteredRows = that.rows.filter(row => {

					const item = that.bottom(row.get(that.axes.bottom.column)) + 100;

					if(mouse[0] < that.zoomRectangle.origin[0])
						return item >= mouse[0] && item <= that.zoomRectangle.origin[0];
					else
						return item <= mouse[0] && item >= that.zoomRectangle.origin[0];
				});

			that.zoomRectangle = null;

			if(!filteredRows.length)
				return;

			that.rows = filteredRows;

			that.plot();
		}, true);
	}
});

Visualization.list.set('stacked', class Stacked extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'stacked');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.render();
	}

	render(resize) {

		this.draw();
		this.plot(resize);
	}

	plot(resize) {

		super.plot(resize);

		if(!this.rows.length)
			return;

		const that = this;

		this.x = d3.scale.ordinal();
		this.y = d3.scale.linear().range([this.height, 20]);

		const
			xAxis = d3.svg.axis()
				.scale(this.x)
				.orient('bottom'),

			yAxis = d3.svg.axis()
				.scale(this.y)
				.innerTickSize(-this.width)
				.orient('left');

		let max = 0;

		for(const row of this.rows) {

			let total = 0;

			for(const [name, value] of row) {
				if(name != this.axes.bottom.column)
					total += parseFloat(value) || 0;
			}

			max = Math.max(max, Math.ceil(total) || 0);
		}

		this.y.domain([0, max]);

		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangeBands([0, this.width], 0.1, 0);

		const
			tickNumber = this.width < 400 ? 3 : 5,
			tickInterval = parseInt(this.x.domain().length / tickNumber),
			ticks = this.x.domain().filter((d, i) => !(i % tickInterval));

		xAxis.tickValues(ticks);

		this.svg
			.append('g')
			.attr('class', 'y axis')
			.call(yAxis)
			.attr('transform', `translate(${this.axes.left.width}, 0)`);

		this.svg
			.append('g')
			.attr('class', 'x axis')
			.attr('transform', `translate(${this.axes.left.width}, ${this.height})`)
			.call(xAxis);

		this.svg
			.append('text')
			.attr('transform', `translate(${(this.width / 2)}, ${this.height + 40})`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.bottom.label);

		this.svg
			.append('text')
			.attr('transform', `rotate(-90) translate(${(this.height / 2 * -1)}, 12)`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.left.label);

		const layer = this.svg
			.selectAll('.layer')
			.data(d3.layout.stack()(this.columns))
			.enter()
			.append('g')
			.attr('class', 'layer')
			.style('fill', d => d.color);

		let bars = layer
			.selectAll('rect')
			.data(column => column)
			.enter()
			.append('rect')
			.classed('bar', true)
			.on('click', function(_, row, column) {
				that.source.columns.get(that.columns[column].key).initiateDrilldown(that.rows[row]);
				d3.select(this).classed('hover', false);
			})
			.on('mouseover', function(_, __, column) {
				that.hoverColumn = that.columns[column];
				d3.select(this).classed('hover', true);
			})
			.on('mouseout', function() {
				that.hoverColumn = null;
				d3.select(this).classed('hover', false);
			})
			.attr('width', this.x.rangeBand())
			.attr('x',  cell => this.x(cell.x) + this.axes.left.width);

		if(!resize) {

			bars = bars
				.attr('height', d => 0)
				.attr('y', d => this.height)
				.transition()
				.duration(Visualization.animationDuration)
				.ease('quad-in');
		}

		bars
			.attr('height', d => this.height - this.y(d.y))
			.attr('y', d => this.y(d.y + d.y0));
	}
});

Visualization.list.set('area', class Area extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'area');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.render();
	}

	render(resize) {

		this.draw();
		this.plot(resize);
	}

	plot(resize) {

		super.plot(resize);

		if(!this.rows || !this.rows.length)
			return;

		const
			container = d3.selectAll(`#visualization-${this.id}`),
			that = this;

		this.x = d3.scale.ordinal();
		this.y = d3.scale.linear().range([this.height, 20]);

		const
			xAxis = d3.svg.axis()
				.scale(this.x)
				.orient('bottom'),

			yAxis = d3.svg.axis()
				.scale(this.y)
				.innerTickSize(-this.width)
				.orient('left');

		let
			max = 0,
			min = 0;

		for(const row of this.rows) {

			let total = 0;

			for(const [name, value] of row) {

				if(name == this.axes.bottom.column)
					continue;

				total += parseFloat(value) || 0;
				min = Math.min(min, Math.floor(value) || 0);
			}

			max = Math.max(max, Math.ceil(total) || 0);
		}

		this.y.domain([min, max]);
		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangePoints([0, this.width], 0.1, 0);

		const
			tickNumber = this.width < 400 ? 3 : 5,
			tickInterval = parseInt(this.x.domain().length / tickNumber),
			ticks = this.x.domain().filter((d, i) => !(i % tickInterval)),

			area = d3.svg.area()
				.x(d => this.x(d.x))
				.y0(d => this.y(d.y0))
				.y1(d => this.y(d.y0 + d.y));

		xAxis.tickValues(ticks);

		this.svg
			.append('g')
			.attr('class', 'y axis')
			.call(yAxis)
			.attr('transform', `translate(${this.axes.left.width}, 0)`);

		this.svg
			.append('g')
			.attr('class', 'x axis')
			.attr('transform', `translate(${this.axes.left.width}, ${this.height})`)
			.call(xAxis);

		this.svg
			.append('text')
			.attr('transform', `translate(${(this.width / 2)}, ${this.height + 40})`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.bottom.label);

		this.svg
			.append('text')
			.attr('transform', `rotate(-90) translate(${(this.height / 2 * -1)}, 12)`)
			.attr('class', 'axis-label')
			.style('text-anchor', 'middle')
			.text(this.axes.left.label);

		let areas = this.svg
			.selectAll('.path')
			.data(d3.layout.stack()(this.columns))
			.enter()
			.append('g')
			.attr('transform', `translate(${this.axes.left.width}, 0)`)
			.attr('class', 'path')
			.append('path')
			.classed('bar', true)
			.on('mouseover', function(column) {
				that.hoverColumn = column;
				d3.select(this).classed('hover', true);
			})
			.on('mouseout', function() {
				that.hoverColumn = null;
				d3.select(this).classed('hover', false);
			})
			.attr('d', d => area(d))
			.style('fill', d => d.color);

		if(!resize) {
			areas = areas
				.style('opacity', 0)
				.transition()
				.duration(Visualization.animationDuration)
				.ease("quad-in");
		}

		areas.style('opacity', 0.8);

		// For each line appending the circle at each point
		for(const column of this.columns) {

			this.svg
				.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'clips')
				.attr('id', (d, i) => i)
				.attr('r', 0)
				.style('fill', column.color)
				.attr('cx', cell => this.x(cell.x) + this.axes.left.width)
				.attr('cy', cell => this.y(cell.y + cell.y0));
		}

		container
		.on('mousemove.area', function() {

			container.selectAll('svg > g > circle[class="clips"]').attr('r', 0);

			const
				mouse = d3.mouse(this),
				xpos = parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length)),
				row = that.rows[xpos];

			if(!row || that.zoomRectangle)
				return;

			container.selectAll(`svg > g > circle[id='${xpos}'][class="clips"]`).attr('r', 6);
		})

		.on('mouseout.area', () => container.selectAll('svg > g > circle[class="clips"]').attr('r', 0));
	}
});

Visualization.list.set('funnel', class Funnel extends Visualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'funnel');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.render();
	}

	render() {

		const
			series = [],
			rows = this.source.response;

		if(rows.length > 1) {

			for(const [i, row] of rows.entries()) {

				series.push([{
					date: 0,
					label: row.get('name'),
					color: DataSourceColumn.colors[i],
					y: row.get('value'),
				}]);
			}
		} else {

			for(const column of this.source.columns.values()) {

				if(column.disabled)
					continue;

				series.push([{
					date: 0,
					label: column.name,
					color: column.color,
					y: rows[0].get(column.key),
				}]);
			}
		}


		this.draw({
			series: series.reverse(),
			divId: `#visualization-${this.id}`,
			chart: {},
		});
	}

	draw(obj) {

		d3.selectAll(obj.divId).on('mousemove', null)
			.on('mouseout', null)
			.on('mousedown', null)
			.on('click', null);

		var chart = {};

		// Setting margin and width and height
		var margin = {top: 20, right: 0, bottom: 40, left: 0},
			width = this.container.clientWidth - margin.left - margin.right,
			height = this.container.clientHeight - margin.top - margin.bottom;

		var x = d3.scale.ordinal()
			.domain([0, 1])
			.rangeBands([0, width], 0.1, 0);

		var y = d3.scale.linear().range([height, margin.top]);

		// Defining xAxis location at bottom the axes
		var xAxis = d3.svg.axis().scale(x).orient("bottom");

		var diagonal = d3.svg.diagonal()
			.source(d => {
				return {x: d[0].y + 5, y: d[0].x};
			})
			.target(d => {
				return {x: d[1].y + 5, y: d[1].x};
			})
			.projection(d => [d.y, d.x]);

		var series = d3.layout.stack()(obj.series);

		series.map(r => r.data = r);

		chart.plot = resize => {

			var funnelTop = width * 0.60,
				funnelBottom = width * 0.2,
				funnelBottonHeight = height * 0.2;

			//Empty the container before loading
			d3.selectAll(obj.divId + " > *").remove();
			//Adding chart and placing chart at specific locaion using translate
			var svg = d3.select(obj.divId)
				.append("svg")
				.append("g")
				.attr("class", "chart")
				.attr("transform", "translate(" + margin.left + "," + margin.top + ")");

			//check if the data is present or not
			if (series.length == 0 || series[0].data.length == 0) {
				//Chart Title
				svg.append('g').attr('class', 'noDataWrap').append('text')
					.attr("x", (width / 2))
					.attr("y", (height / 2))
					.attr("text-anchor", "middle")
					.style("font-size", "20px")
					.text(obj.loading ? "Loading Data ..." : "No data to display");
				return;
			}

			x.domain([0]);
			x.rangeBands([0, width], 0.1, 0);
			y.domain([
				0,
				d3.max(series, function (c) {
					return d3.max(c.data, function (v) {
						return Math.ceil(v.y0 + v.y);
					});
				}) + 4
			]);

			var layer = svg.selectAll(".layer")
				.data(series)
				.enter().append("g")
				.attr("class", "layer")
				.style("fill", d => d[0].color);

			let rectangles = layer.selectAll("rect")
				.data(function (d) {
					return d.data;
				})
				.enter().append("rect")
				.attr("x", d => x(d.date))
				.attr("width", x.rangeBand())

			if(!resize) {
				rectangles = rectangles
					.attr("height", d => 0)
					.attr("y", d => 30)
					.transition()
					.duration(Visualization.animationDuration);
			}

			rectangles
				.attr("height", d => y(d.y0) - y(d.y + d.y0))
				.attr("y", d => y(d.y + d.y0));

			var poly1 = [
				{x: 0, y: margin.top},
				{x: (width - funnelTop) / 2, y: margin.top},
				{x: (width - funnelBottom) / 2, y: height - funnelBottonHeight},
				{x: (width - funnelBottom) / 2, y: height},
				{x: 0, y: height}
			];

			var poly2 = [
				{x: width, y: margin.top},
				{x: (width - funnelTop) / 2 + funnelTop + 5, y: margin.top},
				{x: (width - funnelBottom) / 2 + funnelBottom + 5, y: height - funnelBottonHeight},
				{x: (width - funnelBottom) / 2 + funnelBottom + 5, y: height},
				{x: width, y: height}
			];

			var polygon = svg.selectAll("polygon")
				.data([poly2, poly1])
				.enter().append("polygon")
				.attr('points', d =>  d.map(d => [d.x, d.y].join()).join(' '))
				.attr('stroke', 'white')
				.attr('stroke-width', 2)
				.attr('fill', 'white');

			//selecting all the paths
			var path = svg.selectAll('rect'),
				that = this;

			//mouse over function
			path .on('mousemove', function(d) {

				var cord = d3.mouse(this);

				if (cord[1] < 2 * margin.top || cord[1] > (height + 2 * margin.top) || cord[0] < margin.left || cord[0] > (width + margin.left) || series.length == 0 || series[0].data.length == 0)
					return

				const content = `
					<header>${d.label}</header>
					<div class="body">${d.y}</div>
				`;

				Tooltip.show(that.container, [cord[0], cord[1]], content);
			});
			polygon.on('mouseover', function () {
				Tooltip.hide(that.container);
			});

			var labelConnectors = svg.append('g').attr('class', 'connectors');
			var previousLabelHeight = 0, singPoint = height / d3.max(y.domain());
			for (var i = 0; i < series.length; i++) {
				var section = series[i].data[0];
				var startLocation = section.y0 * singPoint,
					sectionHeight = section.y * singPoint,
					bottomLeft = funnelBottonHeight - startLocation,
					x1, y1,  endingPintY, curveData;
				var label = labelConnectors.append('g');
				var text;

				//for lower part of the funnel
				if (sectionHeight / 2 < bottomLeft) {

					x1 = (width + funnelBottom) / 2;
					y1 = (startLocation + sectionHeight / 2);

					endingPintY = y1;

					if (endingPintY - previousLabelHeight <= 10)
						endingPintY = previousLabelHeight + 5;

					curveData = [
						{x: x1, y: (height) - y1 - 5},
						{x: x1 + (window.innerWidth < 768 ? 30 : 50), y: height - endingPintY}
					];

					text = label.append('text')
						.attr('x', x1 + (window.innerWidth < 768 ? 35 : 60))
						.attr('y', height - (endingPintY))
						.attr('text-anchor', 'left')
						.style('font-size', '15px')

					if (window.innerWidth < 768) {
						text.style('font-size', '10px');
					}
					text.append('tspan')
						.attr('x', x1 + (window.innerWidth < 768 ? 35 : 60))
						.attr('dx', '0')
						.attr('dy', '1em')
						.text(series[i].data[0].label);

					text.append('tspan')
						.attr('x', x1 + (window.innerWidth < 768 ? 35 : 60))
						.attr('dx', '0')
						.attr('dy', '1.2em')
						.style('font-size', '13px')
						.text(`${series[i].data[0].y}  (${(series[i].data[0].y / series[series.length - 1].data[0].y * 100).toFixed(2)}%)`);

				} else {

					//for upper part of the funnel
					var arr = findInterSection(
						width / 2, height - (startLocation + sectionHeight / 2),
						width, height - (startLocation + sectionHeight / 2),
						(width + funnelTop) / 2, margin.top,
						(width + funnelBottom) / 2, height - funnelBottonHeight);

					x1 = arr[0];
					y1 = arr[1];

					endingPintY = y1;
					if ((endingPintY - (endingPintY - previousLabelHeight)) <= 15)
						endingPintY = previousLabelHeight + endingPintY + 15;

					curveData = [
						{x: x1, y: y1},
						{x: x1 + (window.innerWidth < 768 ? 30 : 50), y: endingPintY-20}
					];

					text = label.append('text')
						.attr('x', x1 + (window.innerWidth < 768 ? 40 : 70))
						.attr('y', endingPintY-20)
						.attr('text-anchor', 'left')
						.style('font-size', '15px');

					if (window.innerWidth < 768)
						text.style('font-size', '10px');

					text.append('tspan')
						.attr('x', x1 + (window.innerWidth < 768 ? 35 : 60))
						.attr('dx', '0')
						.attr('dy', '1em')
						.text(series[i].data[0].label);

					text.append('tspan')
						.attr('x', x1 + (window.innerWidth < 768 ? 35 : 60))
						.attr('dx', '0')
						.attr('dy', '1.2em')
						.style('font-size', '13px')
						.text(`${series[i].data[0].y} (${(series[i].data[0].y / series[series.length - 1].data[0].y * 100).toFixed(2)}%)`);
				}

				previousLabelHeight = endingPintY + 45;

				label.datum(curveData)
					.append('path')
					.attr('class', 'link')
					.attr('d', diagonal)
					.attr('stroke', '#2a3f54')
					.attr('stroke-width', 1)
					.attr('fill', 'none');
			}
		};

		chart.plot();

		window.addEventListener('resize', () => {
			width = this.container.clientWidth - margin.left - margin.right;
			chart.plot(true);
		});

		function findInterSection(x1, y1, x2, y2, x3, y3, x4, y4) {
			var m1 = (y2 - y1) / (x2 - x1), m2 = (y4 - y3) / (x4 - x3), b1 = (y1 - m1 * x1), b2 = (y3 - m2 * x3);
			return [((b2 - b1) / (m1 - m2)), -1 * ((b1 * m2 - b2 * m1) / (m1 - m2))];
		}

		return chart;
	}
});

Visualization.list.set('pie', class Pie extends Visualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'pie');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.process();

		this.render();
	}

	process() {

		const
			response = this.source.originalResponse,
			newResponse = {};

		if(!response || !response.data || !response.data.length)
			return;

		for(const row of this.source.originalResponse.data)
			newResponse[row.name] = parseFloat(row.value) || 0;

		this.source.originalResponse.data = [newResponse];

		this.source.columns.clear();
		this.source.columns.update();
		this.source.columns.render();

		const visualizationToggle = this.source.container.querySelector('header .change-visualization');

		if(visualizationToggle)
			visualizationToggle.value = this.source.visualizations.indexOf(this);
	}

	render(resize) {

		this.rows = this.source.response;

		this.height = this.container.clientHeight - 20;
		this.width = this.container.clientWidth - 20;

		window.addEventListener('resize', () => {

			const
				height = this.container.clientHeight - 20,
				width = this.container.clientWidth - 20;

			if(this.width != width || this.height != height)
				this.render(true);
		});

		const
			container = d3.selectAll(`#visualization-${this.id}`),
			radius = Math.min(this.width - 50, this.height - 50) / 2,
			that = this;

		container.selectAll('*').remove();

		if(!this.rows || !this.rows.length)
			return;

		const
			[row] = this.rows,
			data = [],
			sum = Array.from(row.values()).reduce((sum, value) => sum + value, 0);

		for(const [name, value] of this.rows[0])
			data.push({name, value, percentage: Math.floor(value / sum * 1000) / 10});

		const

			pie = d3.layout
				.pie()
				.value(row => row.percentage),

			arc = d3.svg.arc()
				.outerRadius(radius)
				.innerRadius(radius - 75),

			arcHover = d3.svg.arc()
				.outerRadius(radius + 10)
				.innerRadius(radius - 75),

			arcs = container
				.append('svg')
				.data([data])
				.append('g')
				.attr('transform', 'translate(' + (this.width / 2) + ',' + (this.height / 2) + ')')
				.selectAll('g')
				.data(pie)
				.enter()
				.append('g')
				.attr('class', 'pie'),

			slice = arcs.append('path')
				.attr('fill', row => this.source.columns.get(row.data.name).color)
				.classed('pie-slice', true);

		slice
			.on('click', function(column, _, row) {
				that.source.columns.get(column.data.name).initiateDrilldown(that.rows[row]);
				d3.select(this).classed('hover', false);
			})
			.on('mousemove', function(row) {

				const mouse = d3.mouse(this);

				mouse[0] += that.width / 2;
				mouse[1] += that.height / 2;

				const content = `
					<header>${row.data.name}</header>
					<ul class="body">${row.data.value}</ul>
				`;

				Tooltip.show(that.container, mouse, content, row);

				d3.select(this).classed('hover', true);
			})

			.on('mouseenter', function(row) {

				d3
					.select(this)
					.transition()
					.duration(Visualization.animationDuration / 3)
					.attr('d', row => arcHover(row));
			})

			.on('mouseleave', function() {

				d3
					.select(this)
					.transition()
					.duration(Visualization.animationDuration / 3)
					.attr('d', row => arc(row));

				Tooltip.hide(that.container);

				d3.select(this).classed('hover', false);
			});

		if(!resize) {
			slice
				.transition()
				.duration(Visualization.animationDuration / data.length * 2)
				.delay((_, i) => i * Visualization.animationDuration / data.length)
				.attrTween('d', function(d) {

					const i = d3.interpolate(d.endAngle, d.startAngle);

					return t => {
						d.startAngle = i(t);
						return arc(d)
					}
				});
		} else {
			slice.attr('d', row => arc(row));
		}

		// Add the text
		arcs.append('text')
			.attr('transform', row => {
				row.innerRadius = radius - 50;
				row.outerRadius = radius;
				return `translate(${arc.centroid(row)})`;
			})
			.attr('text-anchor', 'middle')
			.text(row => row.data.percentage + '%');
	}
});

Visualization.list.set('spatialmap', class SpatialMap extends Visualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('section');

		const container = this.containerElement;

		container.classList.add('visualization', 'spatial-map');

		container.innerHTML = `
			<div class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(parameters = {}) {

		super.render();

		await this.source.fetch(parameters);

		this.render();
	}

	render() {

		const
			markers = [],
			response = this.source.response;

		// If the maps object wasn't already initialized
		if(!this.map)
			this.map = new google.maps.Map(this.containerElement.querySelector('.container'), { zoom: 12 });

		// If the clustered object wasn't already initialized
		if(!this.clusterer)
			this.clusterer = new MarkerClusterer(this.map, null, { imagePath: 'https://raw.githubusercontent.com/googlemaps/js-marker-clusterer/gh-pages/images/m' });

		// Add the marker to the markers array
		for(const row of response) {
			markers.push(
				new google.maps.Marker({
					position: {
						lat: parseFloat(row.get('lat')),
						lng: parseFloat(row.get('lng')),
					},
				})
			);
		}

		if(!this.markers || this.markers.length != markers.length) {

			// Empty the map
			this.clusterer.clearMarkers();

			// Load the markers
			this.clusterer.addMarkers(markers);

			this.markers = markers;
		}

		// Point the map to location's center
		this.map.panTo({
			lat: parseFloat(response[0].get('lat')),
			lng: parseFloat(response[0].get('lng')),
		});
	}
});

Visualization.list.set('cohort', class Cohort extends Visualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('section');

		container.classList.add('visualization', 'cohort');

		container.innerHTML = `
			<div class="container"></div>
		`;

		return container;
	}

	async load(e) {

		if(e && e.preventDefault)
			e.preventDefault();

		super.render();

		this.container.querySelector('.container').innerHTML = `
			<div class="loading">
				<i class="fa fa-spinner fa-spin"></i>
			</div>
		`;

		await this.source.fetch();

		this.process();
		this.render();
	}

	process() {

		this.max = 0;

		this.source.response.pop();

		for(const row of this.source.response) {

			for(const column of row.get('data') || [])
				this.max = Math.max(this.max, column.count);
		}
	}

	render() {

		const
			container = this.container.querySelector('.container'),
			table = document.createElement('table'),
			tbody = document.createElement('tbody'),
			type = this.source.filters.get('type').label.querySelector('input').value,
			response = this.source.response;

		container.textContent = null;

		table.insertAdjacentHTML('beforeend', `
			<thead>
				<tr>
					<th class="sticky">${type[0].toUpperCase() + type.substring(1)}</th>
					<th class="sticky">Cohort Size</th>
					<th class="sticky">
						${response.length && response[0].get('data').map((v, i) => type[0].toUpperCase()+type.substring(1)+' '+(++i)).join('</th><th class="sticky">')}
					</th>
				</tr>
			</thead>
		`);

		for(const row of response) {

			const cells = [];

			for(const cell of row.get('data')) {

				let contents = Format.number(cell.percentage) + '%';

				if(cell.href)
					contents = `<a href="${cell.href}" target="_blank">${contents}</a>`;

				cells.push(`
					<td style="${this.getColor(cell.count)}" class="${cell.href ? 'href' : ''}" title="${cell.description}">
						${contents}
					</td>
				`);
			}

			let size = Format.number(row.get('size'));

			if(row.get('baseHref'))
				size = `<a href="${row.get('baseHref')}" target="_blank">${size}</a>`;

			tbody.insertAdjacentHTML('beforeend', `
				<tr>
					<td class="sticky">${Format.date(row.get('timing'))}</td>
					<td class="sticky ${row.get('baseHref') ? 'href' : ''}">${size}</td>
					${cells.join('')}
				</tr>
			`);
		}

		if(!response.length)
			table.innerHTML = `<caption class="NA">${this.source.originalResponse.message || 'No data found! :('}</caption>`;

		table.appendChild(tbody);
		container.appendChild(table);
	}

	getColor(count) {

		const intensity = Math.floor((this.max - count) / this.max * 255);

		return `background: rgba(255, ${intensity}, ${intensity}, 0.8)`;
	}
});

Visualization.list.set('bigtext', class NumberVisualizaion extends Visualization {

	get container() {

		if (this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('section');

		container.classList.add('visualization', 'bigtext');

		container.innerHTML = `
			<div class="container"></div>
		`;

		return container;
	}

	async load(e) {

		if (e && e.preventDefault)
			e.preventDefault();

		super.render();
		this.container.querySelector('.container').innerHTML = `
			<div class="loading">
				<i class="fa fa-spinner fa-spin"></i>
			</div>
		`;

		await this.source.fetch();

		this.process();

		this.render();
	}

	process() {

		const [response] = this.source.response;

		if(!this.column)
			return this.source.error('Value column not selected! :(');

		const value = response.get(this.column);

		if(!value)
			return this.source.error(`<em>${this.column}</em> column not found! :(`);

		if(this.valueType == 'number' && isNaN(value))
			return this.source.error('Invalid Number! :(');

		if(this.valueType == 'date' && !Date.parse(value))
			return this.source.error('Invalid Date! :(');
	}

	render() {

		const [response] = this.source.response;

		let value = response.get(this.column);

		if(this.valueType == 'number')
			value = Format.number(value);

		if(this.valueType == 'date')
			value = Format.date(value);

		this.container.querySelector('.container').innerHTML = `
			<div class="value">
				${this.prefix || ''}${value}${this.postfix || ''}
			</div>
		`;
	}
});

Visualization.list.set('livenumber', class LiveNumber extends Visualization {

	get container() {

		if (this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('section');

		container.classList.add('visualization', 'livenumber');

		container.innerHTML = `
			<div class="container"></div>
		`;

		return container;
	}

	async load(e) {

		if (e && e.preventDefault)
			e.preventDefault();

		super.render();
		this.container.querySelector('.container').innerHTML = `
			<div class="loading">
				<i class="fa fa-spinner fa-spin"></i>
			</div>
		`;

		await this.source.fetch();

		this.process();

		this.render();
	}

	process() {
		const response = this.source.response;

		try {
			for (const row of response) {
				const responseDate = (new Date(row.get(this.timingColumn).substring(0, 10))).toDateString();
				const todayDate = new Date();

				for (let box in this.boxes) {
					const configDate = new Date(Date.now() - this.boxes[box].offset * 86400000).toDateString();
					if (responseDate == configDate) {
						this.boxes[box].value = row.get(this.valueColumn);
					}
				}
			}

			for (let box of this.boxes) {
				box.percentage = Math.round(((box.value - this.boxes[box.relativeValTo].value) / box.value) * 100);
			}
		}
		catch (e) {
			return this.source.error(e);
		}
	}

	render() {
		const container = this.container.querySelector('.container');
		container.textContent = null;

		for (let box of this.boxes) {
			const configBox = document.createElement('div');

			configBox.innerHTML = `
				<h7 class="${this.getColor(box.percentage)}">
					${this.prefix || ''}${box.value}${this.postfix || ''}
				</h7>
				<p class="percentage">${box.percentage}%</p>
			`;

			configBox.style = `
				grid-column: ${box.column} / span ${box.columnspan};
				grid-row: ${box.row} / span ${box.rowspan};
			`;

			container.appendChild(configBox);
		}

		this.container.querySelector('p').classList.add('hidden');
	}

	getColor(percentage) {
		if (percentage == 0)
			return '';
		else
			if (percentage > 0)
				if (this.invertValues)
					return 'red';
				else
					return 'green';
			else
				if (this.invertValues)
					return 'green';
				else
					return 'red';
	}
});

Visualization.list.set('json', class JSONVisualization extends Visualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('div');

		const container = this.containerElement;

		container.classList.add('visualization', 'line');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(e, resize) {

		if (e && e.preventDefault)
			e.preventDefault();

		super.render();
		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch();

		this.render(resize);
	}

	render(resize) {

		this.editor = new Editor(this.container);

		this.editor.value = JSON.stringify(this.source.originalResponse.data, 0, 4);

		this.editor.editor.getSession().setMode('ace/mode/json');
	}
});

class Tooltip {

	static show(div, position, content) {

		if(!div.querySelector('.tooltip'))
			div.insertAdjacentHTML('beforeend', `<div class="tooltip"></div>`)

		const
			container = div.querySelector('.tooltip'),
			distanceFromMouse = 40;

		container.innerHTML = content;

		if(container.classList.contains('hidden'))
			container.classList.remove('hidden');

		let left = Math.max(position[0] + distanceFromMouse, 5),
			top = position[1] + distanceFromMouse;

		if(left + container.clientWidth > div.clientWidth)
			left = div.clientWidth - container.clientWidth - 5;

		if(top + container.clientHeight > div.clientHeight)
			top = position[1] - container.clientHeight - distanceFromMouse;

		container.setAttribute('style', `left: ${left}px; top: ${top}px;`);
	}

	static hide(div) {

		const container = div.querySelector('.tooltip');

		if(!container)
			return;

		container.classList.add('hidden');
	}
}

class Dataset {

	constructor(id, filter) {

		if(!MetaData.datasets.has(id))
			throw new Page.exception('Invalid dataset id! :(');

		const dataset = MetaData.datasets.get(id);

		for(const key in dataset)
			this[key] = dataset[key];

		this.filter = filter;
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('dataset');

		if(['Start Date', 'End Date'].includes(this.name)) {

			let value = null;

			if(this.name == 'Start Date')
				value = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

			else
				value = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

			container.innerHTML = `
				<input type="date" name="${this.filter.placeholder}" value="${value}">
			`;

			return container;
		}

		container.innerHTML = `
			<input type="search" placeholder="Search...">
			<div class="options hidden"></div>
		`;

		const
			search = this.container.querySelector('input[type=search]'),
			options = this.container.querySelector('.options');

		search.on('click', e => {

			e.stopPropagation();

			for(const options of document.querySelectorAll('.dataset .options'))
				options.classList.add('hidden');

			search.value = '';
			options.classList.remove('hidden');

			this.update();
		});

		search.on('keyup', () => this.update());

		options.on('click', e => e.stopPropagation());

		document.body.on('click', () => options.classList.add('hidden'));

		options.innerHTML = `
			<header>
				<a class="all">All</a>
				<a class="clear">Clear</a>
			</header>
			<div class="list"></div>
			<div class="no-matches NA hidden">No matches found! :(</div>
			<footer></footer>
		`;

		options.querySelector('header .all').on('click', () => this.all());
		options.querySelector('header .clear').on('click', () => this.clear());

		this.load();

		return container;
	}

	async load() {

		if(!this.query_id)
			return [];

		const
			search = this.container.querySelector('input[type=search]'),
			list = this.container.querySelector('.options .list');

		let values = [];

		try {
			values = await this.fetch();
		} catch(e) {}

		if(!values.length)
			return list.innerHTML = `<div class="NA">No data found! :(</div>`;

		list.textContent = null;

		for(const row of values) {

			const
				label = document.createElement('label'),
				input = document.createElement('input'),
				text = document.createTextNode(row.name);

			input.name = this.filter.placeholder;
			input.value = row.value;
			input.type = this.filter.multiple ? 'checkbox' : 'radio';
			input.checked = true;

			label.appendChild(input);
			label.appendChild(text);

			label.setAttribute('title', row.value);

			label.querySelector('input').on('change', () => this.update());

			list.appendChild(label);
		}

		this.update();
	}

	async fetch() {

		if(!this.query_id)
			return [];

		let
			values,
			timestamp;

		const parameters = {
			id: this.id,
		};

		if(account.auth_api)
			parameters[DataSourceFilter.placeholderPrefix + 'access_token'] = localStorage.access_token;

		try {
			({values, timestamp} = JSON.parse(localStorage[`dataset.${this.id}`]));
		} catch(e) {}

		if(!timestamp || Date.now() - timestamp > Dataset.timeout) {

			({data: values} = await API.call('datasets/values', parameters));

			localStorage[`dataset.${this.id}`] = JSON.stringify({values, timestamp: Date.now()});
		}

		return values;
	}

	async update() {

		if(!this.query_id)
			return [];

		const
			search = this.container.querySelector('input[type=search]'),
			options = this.container.querySelector('.options');

		for(const input of options.querySelectorAll('.list label input')) {

			let hide = false;

			if(search.value && !input.parentElement.textContent.toLowerCase().trim().includes(search.value.toLowerCase().trim()))
				hide = true;

			input.parentElement.classList.toggle('hidden', hide);
			input.parentElement.classList.toggle('selected', input.checked);
		}

		const
			total = options.querySelectorAll('.list label').length,
			hidden = options.querySelectorAll('.list label.hidden').length,
			selected = options.querySelectorAll('.list input:checked').length;

		search.placeholder = `Search... (${selected} selected)`;

		options.querySelector('footer').innerHTML = `
			<span>Total: <strong>${total}</strong></span>
			<span>Showing: <strong>${total - hidden}</strong></span>
			<span>Selected: <strong>${selected}</strong></span>
		`;

		options.querySelector('.no-matches').classList.toggle('hidden', total != hidden);
	}

	set value(source) {

		if(source.query_id) {

			const
				inputs = this.container.querySelectorAll('.options .list label input'),
				sourceInputs = source.container.querySelectorAll('.options .list label input');

			for(const [i, input] of sourceInputs.entries())
				inputs[i].checked = input.checked;
		}

		else {

			for(const input of this.container.querySelectorAll('input'))
				input.checked = source == input.value;
		}

		this.update();
	}

	get value() {
		return this.container.querySelectorAll('.options .list input:checked').length + ' '+ this.name;
	}

	all() {

		if(!this.filter.multiple)
			return;

		for(const input of this.container.querySelectorAll('.options .list label input'))
			input.checked = true;

		this.update();
	}

	clear() {

		for(const input of this.container.querySelectorAll('.options .list label input'))
			input.checked = false;

		this.update();
	}
}

DataSourceFilter.setup();

Node.prototype.on = window.on = function(name, fn) {
	this.addEventListener(name, fn);
}

MetaData.timeout = 5 * 60 * 1000;
Dataset.timeout = 5 * 60 * 1000;
Visualization.animationDuration = 750;

window.onerror = ErrorLogs.send;

"use strict";

class DataSource {

	static async load(force = false) {

		if(DataSource.list && !force)
			return;

		const response = await API.call('reports/report/list');

		DataSource.list = new Map(response.map(report => [report.query_id, report]));
	}

	constructor(source, page) {

		for(const key in source)
			this[key] = source[key];

		this.page = page;

		this.tags = this.tags || '';
		this.tags = this.tags.split(',').filter(a => a.trim());

		this.filters = new DataSourceFilters(this.filters, this);
		this.columns = new DataSourceColumns(this);
		this.transformations = new DataSourceTransformations(this);
		this.visualizations = [];

		if(!source.visualizations)
			source.visualizations = [];

		if(!source.visualizations.filter(v => v.type == 'table').length)
			source.visualizations.push({ name: this.name, visualization_id: 0, type: 'table' });

		source.visualizations = source.visualizations.filter(v => Visualization.list.has(v.type));

		this.visualizations = source.visualizations.map(v => new (Visualization.list.get(v.type))(v, this));
		this.postProcessors = new DataSourcePostProcessors(this);
	}

	async fetch(_parameters = {}) {

		const parameters = new URLSearchParams(_parameters);

		if(typeof _parameters == 'object') {
			for(const key in _parameters)
				parameters.set(key, _parameters[key]);
		}

		parameters.set('query_id', this.query_id);

		if(this.definitionOverride)
			parameters.set('query', this.definition.query);

		for(const filter of this.filters.values()) {

			if(this.visualizations.selected && this.visualizations.selected.options && this.visualizations.selected.options.filters && !this.filters.containerElement) {

				const [visualization_filter] = this.visualizations.selected.options.filters.filter(x => x.filter_id == filter.filter_id);

				if(visualization_filter) {

					if(filter.dataset) {

						await filter.fetch();
						filter.value = visualization_filter.default_value || '';
					}

					parameters.set(DataSourceFilter.placeholderPrefix + filter.placeholder, visualization_filter.default_value);

					continue;
				}
			}

			if(filter.multiSelect) {

				await filter.fetch();

				for(const value of filter.multiSelect.value) {
					parameters.append(DataSourceFilter.placeholderPrefix + filter.placeholder, value);
				}
			}

			else parameters.set(DataSourceFilter.placeholderPrefix + filter.placeholder, filter.value);
		}

		const external_parameters = await Storage.get('external_parameters');

		if(Array.isArray(account.settings.get('external_parameters')) && external_parameters) {

			for(const key of account.settings.get('external_parameters')) {

				if(key in external_parameters)
					parameters.set(DataSourceFilter.placeholderPrefix + key, external_parameters[key]);
			}
		}

		let response = null;

		const options = {
			method: 'POST',
		};

		this.resetError();

		if(this.refresh_rate) {

			clearTimeout(this.refreshRateTimeout);

			this.refreshRateTimeout = setTimeout(() => {
				if(this.containerElement && document.body.contains(this.container))
					this.visualizations.selected.load();
			}, this.refresh_rate * 1000);
		}

		try {
			response = await API.call('reports/engine/report', parameters.toString(), options);
		}

		catch(e) {

			response = {};

			let message = e.message;

			if(typeof e.body == 'object') {
				message = message.replace('You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use', '');
				this.error(JSON.stringify(message, 0, 4));

				throw e;
			}
			else {

				this.error('Click here to retry', {retry: true});
				throw e;
			}
		}

		if(parameters.get('download'))
			return response;

		this.originalResponse = response;

		this.columns.update();
		this.postProcessors.update();
		this.render();
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		this.containerElement = document.createElement('section');

		const container = this.containerElement;

		container.classList.add('data-source');

		container.innerHTML = `

			<header>
				<h2>
					<span class="title">${this.name}</span>
					<a class="menu-toggle" title="Menu"><i class="fa fa-angle-down"></i></a>
				</h2>
				<div class="actions right"></div>
			</header>

			<div class="columns"></div>
			<div class="drilldown hidden"></div>

			<div class="query overlay hidden">
				<code></code>
				<div class="close">&times;</div>
			</div>

			<div class="description overlay hidden">
				<div class="body"></div>
				<div class="footer hidden">

					<span>
						<span class="label">Role:</span>
						<span>${MetaData.roles.has(this.roles) ? MetaData.roles.has(this.roles).name : '<span class="NA">NA</span>'}</span>
					</span>

					<span>
						<span class="label">Added On:</span>
						<span title="${Format.date(this.created_at)}">${Format.ago(this.created_at)}</span>
					</span>

					<span>
						<span class="label">Cached:</span>
						<span class="cached"></span>
					</span>

					<span>
						<span class="label">Runtime:</span>
						<span class="runtime"></span>
					</span>

					<span class="right visible-to hidden">
						<span class="label">Visible To</span>
						<span class="count"></span>
					</span>

					<span>
						<span class="label">Added By:</span>
						<span><a href="/user/profile/${this.added_by}">${this.added_by_name || 'NA'}</a></span>
					</span>
				</div>
				<div class="close">&times;</div>
			</div>
		`;

		const menuToggle = container.querySelector('header .menu-toggle');

		menuToggle.on('click', e => {

			e.stopPropagation();

			if(!container.contains(this.menu))
				container.appendChild(this.menu);

			this.menu.classList.toggle('hidden');
			this.menu.style.left = menuToggle.offsetLeft + 'px';
			menuToggle.classList.toggle('selected');

			document.body.removeEventListener('click', this.menuToggleListener);

			if(!this.menu.classList.contains('hidden')) {
				document.body.on('click', this.menuToggleListener = e => {
					menuToggle.click();
				});
			}
		});

		if(this.editable) {

			container.querySelector('.description .footer').classList.remove('hidden');

			container.querySelector('.description .visible-to .count').on('click', () => {

				if(this.dialogue)
					return this.dialogue.show();

				this.dialogue = new DialogBox();

				this.dialogue.heading = 'Users';

				const user_element = [];

				for(const user of this.visibleTo) {
					user_element.push(`
						<li>
							<a href="/user/profile/${user.user_id}">${user.name}</a>
							<span>${user.reason}</span>
						</li>
					`);
				}

				this.dialogue.body.insertAdjacentHTML('beforeend', `<ul class="user-list">${user_element.join('')}</ul>`);
				this.dialogue.show();
			});
		}

		container.querySelector('.description .close').on('click', () => container.querySelector('.menu .description-toggle').click());
		container.querySelector('.query .close').on('click', () => container.querySelector('.menu .query-toggle').click());

		if(this.visualizations.length) {

			for(const visualization of this.visualizations) {

				if(visualization.default)
					this.visualizations.selected = visualization;
			}

			if(!this.visualizations.selected)
				this.visualizations.selected = Array.from(this.visualizations)[0];

			if(this.visualizations.selected)
				container.appendChild(this.visualizations.selected.container);
		}

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
					title.push(`${source.drilldown.parent.filters.has(p.placeholder) ? source.drilldown.parent.filters.get(p.placeholder).name : p.placeholder}: ${p.selectedValue}`);

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

	get menu() {

		if(this.menuElement)
			return this.menuElement;

		const menu = this.menuElement = document.createElement('div');

		menu.classList.add('menu', 'hidden');

		menu.innerHTML = `

			<div class="item hidden">
				<span class="label filters-toggle"><i class="fa fa-filter"></i> Filters</span>
			</div>

			<div class="item">
				<span class="label description-toggle"><i class="fa fa-info"></i> Info</span>
			</div>

			<div class="item">
				<span class="label change-visualization"><i class="fas fa-chart-line"></i> Visualizations</span>
				<div class="submenu"></div>
			</div>

			<div class="item" title="Download CSV">

				<span class="label download" title="Download Report"><i class="fa fa-download"></i> Download</span>

				<div class="submenu">

					<div class="item">
						<span class="label csv-download"><i class="far fa-file-excel"></i> CSV</label>
					</div>

					<div class="item">
						<span class="label filtered-csv-download"><i class="far fa-file-excel"></i> Filtered CSV</label>
					</div>

					<div class="item">
						<span class="label xlsx-download"><i class="fas fa-file-excel"></i> XLSX</label>
					</div>

					<div class="item">
						<span class="label json-download"><i class="fas fa-code"></i> JSON</label>
					</div>

					<!--<div class="item">
						<span class="label export-toggle"><i class="fa fa-download"></i> Export</label>
					</div>>-->
				</div>
			</div>

			<div class="item view hidden">
				<span class="label expand-toggle"><i class="fas fa-expand-arrows-alt"></i> Expand</span>
			</div>

			<div class="item hidden">
				<a class="label configure-visualization">
					<i class="fas fa-cog"></i>
					<span>Configure</span>
				</a>
			</div>

			<div class="item hidden">
				<a class="label define-visualization" href="/reports/define-report/${this.query_id}">
					<i class="fas fa-pencil-alt"></i>
					<span>Define</span>
				</a>
			</div>

			<div class="item hidden">
				<span class="label query-toggle"><i class="fas fa-file-alt"></i> Query</span>
			</div>

			<div class="item">
				<span class="label reload"><i class="fas fa-sync"></i> Reload</span>
			</div>
		`;

		// menu.on('click', e => e.stopPropagation());

		const
			filtersToggle = menu.querySelector('.filters-toggle'),
			descriptionToggle = menu.querySelector('.description-toggle'),
			queryToggle = menu.querySelector('.query-toggle');

		if(this.editable) {

			const elementsToShow = [
				'.menu .expand-toggle',
				'.menu .query-toggle',
				'.menu .configure-visualization',
				'.menu .define-visualization',
			];

			for(const element of elementsToShow)
				menu.querySelector(element).parentElement.classList.remove('hidden');
		}

		menu.querySelector('.reload').on('click', () => this.visualizations.selected.load());

		filtersToggle.on('click', () => {

			filtersToggle.parentElement.classList.toggle('selected');

			if(queryToggle.parentElement.classList.contains('selected'))
				queryToggle.click();

			if(descriptionToggle.parentElement.classList.contains('selected'))
				descriptionToggle.click();

			this.visualizations.selected.container.classList.toggle('blur');
			this.container.querySelector('.columns').classList.toggle('blur');

			if(this.container.contains(this.filters.container))
				this.container.removeChild(this.filters.container);

			else this.container.insertBefore(this.filters.container, this.container.querySelector('.columns'));

			this.visualizations.selected.render({resize: true});
		});

		// If there are filters and every filter is not of hidden type then show the filters toggle
		if(this.filters.size && !Array.from(this.filters.values()).every(f => f.type == 'hidden'))
			filtersToggle.parentElement.classList.remove('hidden');

		descriptionToggle.on('click', async () => {

			if(queryToggle.parentElement.classList.contains('selected'))
				queryToggle.click();

			if(filtersToggle.parentElement.classList.contains('selected'))
				filtersToggle.click();

			this.container.querySelector('.description').classList.toggle('hidden');
			descriptionToggle.parentElement.classList.toggle('selected');
			this.visualizations.selected.container.classList.toggle('blur');
			this.container.querySelector('.columns').classList.toggle('blur');

			this.visualizations.selected.render({resize: true});

			if(user.privileges.has('report') && user.privileges.has('user')) {

				await this.userList();
				this.container.querySelector('.visible-to').classList.remove('hidden');
				this.container.querySelector('.description .count').textContent = `${this.visibleTo.length} people`;
			}
		});

		queryToggle.on('click', () => {

			if(filtersToggle.parentElement.classList.contains('selected'))
				filtersToggle.click();

			if(descriptionToggle.parentElement.classList.contains('selected'))
				descriptionToggle.click();

			this.container.querySelector('.query').classList.toggle('hidden');
			queryToggle.parentElement.classList.toggle('selected');
			this.visualizations.selected.container.classList.toggle('blur');
			this.container.querySelector('.columns').classList.toggle('blur');

			this.visualizations.selected.render({resize: true});
		});

		menu.insertBefore(this.postProcessors.container, menu.querySelector('.change-visualization').parentElement);

		menu.querySelector('.csv-download').on('click', (e) => this.download(e, {mode: 'csv'}));
		menu.querySelector('.filtered-csv-download').on('click', (e) => this.download(e, {mode: 'filtered-csv'}));
		menu.querySelector('.json-download').on('click', (e) => this.download(e, {mode: 'json'}));
		menu.querySelector('.xlsx-download').on('click', (e) => this.download(e, {mode: 'xlsx'}));
		menu.querySelector('.expand-toggle').on('click', () => window.location = `/report/${this.query_id}`);

		if(this.visualizations.length) {

			const changeVisualization = menu.querySelector('.change-visualization');

			for(const visualization of this.visualizations) {

				const item = document.createElement('div');

				item.classList.add('item');

				item.on('click', () => visualization.load());

				item.dataset.id =  visualization.visualization_id;

				item.innerHTML = `
					<div class="label">
						<span class="no-icon">
							${visualization.name}<br>
							<span class="NA">${visualization.type}</span>
						</span>
					</div>
				`;

				changeVisualization.parentElement.querySelector('.submenu').appendChild(item);
			}

			if(this.visualizations.length > 1)
				changeVisualization.classList.remove('hidden');
		}

		this.xlsxDownloadable = [...MetaData.visualizations.values()].filter(x => x.excel_format).map(x => x.slug).includes(this.visualizations.selected.type);

		const xlsxDownloadDropdown = menu.querySelector('.xlsx-download');

		xlsxDownloadDropdown.classList.toggle('hidden', !this.xlsxDownloadable);

		if(this.visualizations.selected.visualization_id)
			menu.querySelector('.configure-visualization').href = `/reports/configure-visualization/${this.visualizations.selected.visualization_id}`;
	}

	async userList() {

		if(this.visibleTo)
			return this.visibleTo;

		this.visibleTo =  await API.call('reports/report/userPrvList', {report_id : this.query_id});
	}

	async response() {

		this.resetError();

		if(!this.originalResponse || !this.originalResponse.data)
			return [];

		let response = [];

		this.originalResponse.groupedAnnotations = new Map;

		if(!Array.isArray(this.originalResponse.data))
			return [];

		const data = await this.transformations.run(this.originalResponse.data);

		if(!this.columns.list.size)
			return this.error();

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
					firstValue = a.get(this.columns.sortBy.key),
					secondValue = b.get(this.columns.sortBy.key),
					first = (firstValue === null ? '' : firstValue).toString().toLowerCase(),
					second = (secondValue === null ? '' : secondValue).toString().toLowerCase();

				let result = 0;

				if(!isNaN(first) && !isNaN(second))
					result = first - second;

				else if(first < second)
					result = -1;

				else if(first > second)
					result = 1;

				if(parseInt(this.columns.sortBy.sort) === 0)
					result *= -1;

				return result;
			});
		}

		return response;
	}

	async download(e, what) {

		this.containerElement.querySelector('.menu .download').classList.remove('selected');
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

			for(const row of await this.response()) {

				const temp = {};
				const arr = [...row];
				for(const cell of arr) {
					temp[cell[0]] = cell[1];
				}

				response.push(temp)
			}

			const obj = {
				columns :[...this.columns.entries()].map(x => x[0]),
				visualization: this.visualizations.selected.type,
				sheet_name :this.name.replace(/[^a-zA-Z0-9]/g,'_'),
				file_name :this.name.replace(/[^a-zA-Z0-9]/g,'_'),
				token : (await Storage.get('token')).body,
				show_legends: !this.visualizations.selected.options.hideLegend || 0,
				show_values: this.visualizations.selected.options.showValues || 0,
				classic_pie: this.visualizations.selected.options.classicPie
			};

			for(const axis of this.visualizations.selected.options.axes || []) {
				if(axis.columns.length)
					obj[axis.position] = axis.columns[0].key;
			}

			return await this.excelSheetDownloader(response, obj);
		}

		else if(what.mode == 'filtered-csv') {

			const response = await this.response();

			for(const row of response) {

				const line = [];

				for(const value of row.values())
					line.push(JSON.stringify(String(value)));

				str.push(line.join());
			}

			str = Array.from(response[0].keys()).join() + '\r\n' + str.join('\r\n');

			what.mode = 'csv';
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

		obj.data = data;

		const xlsxBlobOutput = await (await (fetch("/api/v2/reports/engine/download", {
			body: JSON.stringify(obj),
			headers: {
				'content-type': 'application/json'
			},
			method: 'POST',
		}))).blob();

		const link = document.createElement('a');
		link.href = window.URL.createObjectURL(xlsxBlobOutput);
		link.download = obj.file_name + "_" + new Date().toString().replace(/ /g, "_") + ".xlsx";
		link.click();
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

	error(message = '', {retry = false} = {}) {

		if(this.container.querySelector('pre.warning'))
			return;

		this.resetError();

		this.container.insertAdjacentHTML('beforeend', `
			<pre class="warning">
				<h2>No Data Found!</h2>
				<span>${message}</span>
			</pre>
		`);

		if(retry) {

			const pre = this.container.querySelector('.warning');
			pre.classList.add('retry');

			pre.on('click', () => this.visualizations.selected.load());
		};

		this.visualizations.selected.container.classList.add('hidden');
	}

	render() {

		const drilldown = [];

		for(const column of this.columns.values()) {

			if(column.drilldown && column.drilldown.query_id)
				drilldown.push(column.name);
		}

		if(drilldown.length) {

			const
				actions = this.container.querySelector('header .actions'),
				old = actions.querySelector('.drilldown');

			if(old)
				old.remove();

			actions.insertAdjacentHTML('beforeend', `
				<span class="grey drilldown" title="Drilldown available on: ${drilldown.join(', ')}">
					<i class="fas fa-angle-double-down"></i>
				</span>
			`);
		}

		const description = this.container.querySelector('.description .body');
		description.textContent = null;

		description.classList.remove('NA');
		if (!this.description && !this.visualizations.selected.description) {
			description.classList.add('NA');
			description.innerHTML = 'No description found!';
		}
		else {
			if (this.description)
				description.insertAdjacentHTML('beforeend', '<h3>Report Description</h3>' + this.description);

			if (this.visualizations.selected.description)
				description.insertAdjacentHTML('beforeend', '<h3>Visualization Description</h3>' + this.visualizations.selected.description);
		}

		for(const item of this.container.querySelectorAll('.change-visualization + .submenu .item'))
			item.classList.toggle('selected', item.dataset.id == this.visualizations.selected.visualization_id);

		this.container.querySelector('.query code').innerHTML = new FormatSQL(this.originalResponse.query).query;

		let age = this.originalResponse.cached ? Math.floor(this.originalResponse.cached.age * 100) / 100 : 0;

		if(age < 1000)
			age += 'ms';

		else if(age < 1000 * 60)
			age = Format.number((age / 1000)) + 's';

		else if(age < 1000 * 60 * 60)
			age = Format.number((age / (1000 * 60))) + 'h';

		let runtime = Math.floor(this.originalResponse.runtime * 100) / 100;

		if(runtime < 1000)
			runtime += 'ms';

		else if(runtime < 1000 * 60)
			runtime = (runtime / 1000) + 's';

		else if(runtime < 1000 * 60 * 60)
			runtime = (runtime / (1000 * 60)) + 'h';

		this.container.querySelector('.description .cached').textContent = this.originalResponse.cached && this.originalResponse.cached.status ? age : 'No';
		this.container.querySelector('.description .runtime').textContent = runtime;

		this.columns.render();
	}
}

/**
 * A group of DataSource filters.
 * This class provides the container and a submit mechanism to load the report.
 */
class DataSourceFilters extends Map {

	/**
	 * Generate a list of DataSourceFilter objects in the ideal order. This does a few more things.
	 *
	 * - Group the date ranges together.
	 * - Create a new date range filter to accompany any date range pairs.
	 * - Generate the DataSourceFilter objects and attach them to the class with placeholder as the key.
	 *
	 * @param Array			filters	A list of filters and their properties.
	 * @param DataSource	source	The owner DataSource object. Optional because we can have a filter list independently from the source.
	 */
	constructor(filters, source = null) {

		super();

		this.source = source;

		if(!filters || !filters.length)
			return;

		filters = new Map(filters.map(f => [f.placeholder, f]));

		// Create a Map of different date filter pairs
		const filterGroups = new Map;

		// Place the date filters alongside their partners in the map
		// The goal is to group together the start and end dates of any one filter name
		for(const filter of filters.values()) {

			if(filter.type != 'date' || (!filter.name.toLowerCase().includes('start') && !filter.name.toLowerCase().includes('end')))
				continue;

			// Remove the 'start', 'end', 'date' and spaces to create a name that would (hopefuly) identify the filter pairs.
			const name = filter.name.replace(/(start|end|date)/ig, '').trim();

			if(!filterGroups.has(name)) {
				filterGroups.set(name, [{
					filter_id: Math.random(),
					name: filter.name.replace(/(start|end|date)/ig, '') + ' Date Range',
					placeholder: name + '_date_range',
					placeholders: [],
					type: 'daterange',
					companions: [],
				}]);
			}

			const group = filterGroups.get(name);

			group[0].companions.push(filter);
			group.push(filter);
		}

		// Remove any groups that don't have a start and end date (only)
		for(const [name, group] of filterGroups)

		// Go through each filter group and sort by the name to bring start filter before the end.
		// And also add them to the master global filter list to bring them together.
		for(let filterGroup of filterGroups.values()) {

			// Make sure the Date Range filter comes first, followed by start date and then finally the end date.
			filterGroup = filterGroup.sort((a, b) => {
				return a.name.toLowerCase().includes('start') || a.type == 'daterange' ? -1 : 1;
			});

			for(const filter of filterGroup) {
				filters.delete(filter.placeholder);
				filters.set(filter.placeholder, filter);
			}
		}

		for(const filter of filters.values())
			this.set(filter.placeholder, new DataSourceFilter(filter, this));
	}

	/**
	 * The main container of the filters.
	 * This is a lazy loaded list of filter labels and the submit button.
	 *
	 * @return HTMLElement
	 */
	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('form');

		container.classList.add('toolbar', 'form', 'filters', 'overlay');

		for(const filter of this.values()) {

			filter.label.on('click', e => e.stopPropagation());

			container.appendChild(filter.label);
		}

		container.on('submit', e => {

			e.preventDefault();

			this.apply();

			this.source.container.querySelector('.filters-toggle').click()
		});

		container.insertAdjacentHTML('beforeend', `

			<label>
				<span>&nbsp;</span>
				<button type="submit" class="apply">
					<i class="fas fa-paper-plane"></i> Apply
				</button>
			</label>

			<div class="close">&times;</div>
		`);

		container.querySelector('.close').on('click', () => this.source.container.querySelector('.filters-toggle').click());

		return container;
	}

	/**
	 * Submit the filters values and load the report with the new data.
	 * This only works whent the owner DataSorce object is passed in constructor.
	 */
	async apply() {

		if(!this.source)
			return;

		this.source.visualizations.selected.load();

		const toggle = this.source.container.querySelector('.filters-toggle.selected');

		if(toggle)
			toggle.click();
	}
}

/**
 * The class representing one single DataSource filter. It has a few responsibilities.
 *
 * - Initialize the label container.
 * - Act as a black box when dealing with fitler value. Lets the user set or get the currnet value of the
 * 	 filter without worrying about the specifics like filter type, default value, current container initialization state etc.
 * - Fetch the report data when the filter as a dataset report attached to it.
 * - Handle special filter types like daterange that affect other filters.
 */
class DataSourceFilter {

	/**
	 * Set up some constant properties.
	 */
	static setup() {

		DataSourceFilter.placeholderPrefix = 'param_';
		DataSourceFilter.timeout = 5 * 60 * 1000;

		DataSourceFilter.dateRanges = [
			{
				start: 0,
				end: 0,
				name: 'Today',
			},
			{
				start: -1,
				end: -1,
				name: 'Yesterday',
			},
			{
				start: -7,
				end: 0,
				name: 'Last 7 Days',
			},
			{
				start: -30,
				end: 0,
				name: 'Last 30 Days',
			},
			{
				start: -90,
				end: 0,
				name: 'Last 90 days',
			},
			{
				start: -365,
				end: 0,
				name: 'Last Year',
			},
		];
	}

	constructor(filter, filters = null) {

		Object.assign(this, filter);

		this.filters = filters;

		if(this.dataset && DataSource.list.has(this.dataset))
			this.multiSelect = new MultiSelect({multiple: this.multiple});

		this.valueHistory = [];

		if(this.type != 'daterange')
			return;

		this.dateRanges = JSON.parse(JSON.stringify(DataSourceFilter.dateRanges));

		if(account.settings.has('global_filters_date_ranges'))
			this.dateRanges = account.settings.has('global_filters_date_ranges');

		this.dateRanges.push({name: 'Custom'});
	}

	get label() {

		if(this.labelContainer)
			return this.labelContainer;

		const container = document.createElement('label');

		container.style.order = this.order;

		if(!MetaData.filterTypes.has(this.type))
			return container;

		if(this.type == 'hidden')
			container.classList.add('hidden');

		let input;

		if(this.multiSelect)
			input = this.multiSelect.container;

		else if(this.type == 'daterange') {

			input = document.createElement('select');

			for(const [index, range] of this.dateRanges.entries())
				input.insertAdjacentHTML('beforeend', `<option value="${index}">${range.name}</option>`);

			input.value = this.value;

			input.on('change', () => this.dateRangeUpdate());
		}

		else {

			input = document.createElement('input');

			input.type = MetaData.filterTypes.get(this.type).input_type;
			input.name = this.placeholder;

			input.value = this.value;
		}

		container.innerHTML = `<span>${this.name}<span>`;
		container.appendChild(input);

		// Timing of this is critical
		this.labelContainer = container;

		this.dateRangeUpdate();

		// Empty the cached value which was recieved before the filter container was created.
		delete this.valueCache;

		return container;
	}

	get value() {

		if(this.multiSelect)
			return this.multiSelect.value;

		if(this.labelContainer)
			return this.label.querySelector(this.type == 'daterange' ? 'select' : 'input').value;

		// If a value was recieved before the container could be created
		if('valueCache' in this)
			return this.valueCache;

		// If the filter's type is a date range then it's default value depends on it's companion filters' values
		if(this.type == 'daterange') {

			// The default date range value is the custom value in case no other filter preset matches
			let value = this.dateRanges.length - 1;

			// Find the date range that matches the selected date range values for the current filter's companions
			for(const [index, range] of this.dateRanges.entries()) {

				let match = true;

				for(let companion of this.companions || []) {

					companion = this.filters.get(companion.placeholder);

					const
						date = Date.parse(companion.value),
						today = new Date(new Date().toISOString().substring(0, 10)).getTime();

					if(!date)
						break;

					if(companion.name.toLowerCase().includes('start') && date != today + ((range.start) * 24 * 60 * 60 * 1000))
						match = false;

					else if(companion.name.toLowerCase().includes('end') && date != today + ((range.end) * 24 * 60 * 60 * 1000))
						match = false;
				}

				if(!match)
					continue;

				value = index;
				break
			}

			return value;
		}

		let value = this.default_value;

		if(!isNaN(parseFloat(this.offset))) {

			if(this.type.includes('date')) {
				const today = new Date();
				value = new Date(Date.nowUTC() + (this.offset * 24 * 60 * 60 * 1000)).toISOString().substring(0, 10);
			}

			if(this.type == 'month') {
				const date = new Date();
				value = new Date(Date.UTC(date.getFullYear(), date.getMonth() + this.offset, 1)).toISOString().substring(0, 7);
			}
		}

		// If an offset and a default value was provided for the offset then create a new default value
		if(this.type == 'datetime' && this.default_value && value)
			value = value + 'T' + this.default_value;

		return value;
	}

	set value(value) {

		this.valueHistory.push(value);

		if(this.multiSelect)
			return this.multiSelect.value = value;

		if(!this.labelContainer)
			return this.valueCache = value;

		if(this.type == 'daterange') {
			this.label.querySelector('select').value = value;
			this.dateRangeUpdate();
			return;
		}

		this.label.querySelector('input').value = value;
	}

	async fetch() {

		if(!this.dataset || !this.multiSelect)
			return [];

		await DataSource.load();

		let
			values,
			timestamp;

		const report = new DataSource(DataSource.list.get(this.dataset), window.page);

		if(Array.from(report.filters.values()).some(f => f.dataset == this.dataset))
			return [];

		if (await Storage.has(`dataset.${this.dataset}`))
			({values, timestamp} = await Storage.get(`dataset.${this.dataset}`));

		if(!timestamp || Date.now() - timestamp > DataSourceFilter.timeout) {

			const
				response = await report.fetch({download: true}),
				values = response.data;
			await Storage.set(`dataset.${this.dataset}`, {values, timestamp: Date.now()});
		}

		({values, timestamp} = await Storage.get(`dataset.${this.dataset}`));

		if(!this.multiSelect.datalist || !this.multiSelect.datalist.length) {
			this.multiSelect.datalist = values;
			this.multiSelect.multiple = this.multiple;
			this.multiSelect.all();
		}

		return values;
	}

	dateRangeUpdate() {

		if(this.type != 'daterange')
			return;

		const
			select = this.label.querySelector('select'),
			range = this.dateRanges[select.value];

		if(!range)
			return;

		// Show / hide other companion inputs depending on if custom was picked.
		for(let companion of this.companions || []) {

			companion = this.filters.get(companion.placeholder);

			// If the option was the last one. We don't check the name because
			// the user could have give a custom name in account settings.
			companion.label.classList.toggle('hidden', select.value != this.dateRanges.length - 1);

			const date = companion.name.toLowerCase().includes('start') ? range.start : range.end;

			if(date === undefined)
				continue;

			companion.value = new Date(Date.now() + date * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
		}
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

			if(column.filters && column.filters.length) {

				for(const search of column.filters) {

					if(search.value === '')
						continue;

					if(!row[key])
						this.skip = true;

					if(!search.slug)
						continue;

					// Look for a filter with the selected filter's slug
					const [filter] = DataSourceColumnFilter.types.filter(f => f.slug == search.slug);

					if(!filter)
						continue;

					// Apply the filter. It checks if a row passes a filter or not.
					if(!filter.apply(search.value, row[key] === null ? '' : row[key]))
						this.skip = true;
				}
			}

			this.set(key, row[key]);
		}

		// Sort the row by position of their columns in the source's columns map
		const values = [...this.entries()].sort((a, b) => columnKeys.indexOf(a[0]) - columnKeys.indexOf(b[0]));

		this.clear();

		for(const [key, value] of values)
			this.set(key, value);

		this.annotations = new Set();
	}

	/**
	 * Get a user presentable value for a column in report.
	 * We need a separate way to get this value because applying type information in a graph usually breaks the graphs.
	 * So this value will only be used when showing the value to the user on screen and not to calculate the data.
	 *
	 * This will do things like
	 * - Apply prefix/postfix.
	 * - Apply date/number type formating.
	 *
	 * @param  string	key		The key whose value is needed.
	 * @param  string	value	An optional value, can be used to format this value with given key's settings.
	 * @return string			The value of the column with it's type information applied to it.
	 */
	getTypedValue(key, value = null) {

		if(!this.has(key))
			return undefined;

		if(!this.source.columns.has(key))
			return undefined;

		const column = this.source.columns.get(key);

		if(!value)
			value = this.get(key);

		if(column.type == 'date')
			value = Format.date(value);

		if(column.type == 'month')
			value = Format.month(value);

		if(column.type == 'year')
			value = Format.year(value);

		if(column.type == 'timeelapsed')
			value = Format.ago(value);

		if(column.type == 'time')
			value = Format.time(value);

		if(column.type == 'datetime')
			value = Format.dateTime(value);

		else if(column.type == 'number')
			value = Format.number(value);

		if(column.prefix)
			value = column.prefix + value;

		if(column.postfix)
			value = value + column.postfix;

		return value;
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

		const container = this.source.container.querySelector('.columns');

		container.textContent = null;

		for(const column of this.values()) {

			if(!column.hidden)
				container.appendChild(column.container);
		}

		if(!this.size)
			container.innerHTML = '&nbsp;';

		if(this.source.visualizations.selected && this.source.visualizations.selected.options && this.source.visualizations.selected.options.hideLegend)
			this.source.container.querySelector('.columns').classList.add('hidden');

		this.overFlow();
	}

	get list() {

		const result = new Map;

		for(const [key, column] of this) {

			if(!column.disabled)
				result.set(key, column);
		}

		return result;
	}

	overFlow() {

		const container = this.source.container.querySelector('.columns');

		container.classList.toggle('over-flow', container.offsetWidth < container.scrollWidth);
	}
}

class DataSourceColumn {

	constructor(column, source) {

		DataSourceColumn.colors = [
			'#3e7adc',
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

		this.key = column;
		this.source = source;
		this.name = this.key.split('_').filter(w => w.trim()).map(w => w.trim()[0].toUpperCase() + w.trim().slice(1)).join(' ');
		this.disabled = false;
		this.color = DataSourceColumn.colors[this.source.columns.size % DataSourceColumn.colors.length];

		if(this.source.format && this.source.format.columns) {

			const [format] = this.source.format.columns.filter(column => column.key == this.key);

			for(const key in format || {})
				this[key] = format[key];
		}

		this.columnFilters = new DataSourceColumnFilters(this);
		this.columnAccumulations = new DataSourceColumnAccumulations(this);
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('column');

		container.innerHTML = `
			<span class="label">
				<span class="color" style="background: ${this.color}"></span>
				<span class="name">${this.name}</span>
			</span>
		`;

		if(user.privileges.has('report')) {

			const edit = document.createElement('a');

			edit.classList.add('edit-column');
			edit.title = 'Edit Column';
			edit.on('click', e => {

				e.stopPropagation();

				this.form.classList.remove('compact');
				this.edit();
			});

			edit.innerHTML = `&#8285;`;

			this.container.querySelector('.label').appendChild(edit);
		}

		let timeout;

		container.querySelector('.label').on('click', async () => {

			clearTimeout(timeout);

			timeout = setTimeout(async () => {

				let found = false;

				if(!this.source.format)
					this.source.format = {};

				if (this.source.format.columns) {
					for (const column of this.source.format.columns) {
						if (column.key == this.key) {
							column.disabled = !column.disabled;
							found = true;
							break;
						}
					}
				}

				if (!found) {
					if (!this.source.format.columns)
						this.source.format.columns = [];

					this.source.format.columns.push({
						key: this.key,
						disabled: true,
					});
				}

				this.disabled = !this.disabled;

				this.source.columns.render();
				await this.update();
			}, 300);
		});

		container.querySelector('.label').on('dblclick', async (e) => {

			clearTimeout(timeout);

			if(this.clicked == null)
				this.clicked = true;

			for(const column of this.source.columns.values()) {

				if(column.key == this.key || (this.source.visualizations.selected.axes && column.key == this.source.visualizations.selected.axes.bottom.column))
					continue;

				column.clicked = null;
				column.disabled = this.clicked;
				column.source.columns.render();
				await column.update();
			}

			this.clicked = !this.clicked;
			this.disabled = false;

			this.source.columns.render();

			await this.update();
		});

		this.setDragAndDrop();

		return container;
	}

	edit() {

		this.dialogueBox.body.appendChild(this.form);

		for(const key in this) {

			if(key in this.form)
				this.form[key].value = this[key];
		}

		if(this.drilldown && this.drilldown.query_id) {

			this.drilldownQuery.value = this.drilldown && this.drilldown.query_id ? [this.drilldown.query_id] : [];
		}
		else {
			this.drilldownQuery.clear();
		}

		this.form.disabled.value = parseInt(this.disabled) || 0;

		this.dialogueBox.show();
	}

	get form() {

		if(this.formContainer)
			return this.formContainer;

		const form = this.formContainer = document.createElement('form');

		form.classList.add('block', 'form', 'column-form');

		form.innerHTML = `
			<label>
				<span>Key</span>
				<input type="text" name="key" value="${this.key}" disabled readonly>
			</label>

			<label>
				<span>Name</span>
				<input type="text" name="name" value="${this.name}" >
			</label>

			<label class="columnType">
				<span>Type</span>
				<select name="type">
					<option value="string">String</option>
					<option value="number">Number</option>
					<option value="date">Date</option>
					<option value="month">Month</option>
					<option value="year">Year</option>
					<option value="time">Time</option>
					<option value="datetime">Date Time</option>
					<option value="timeelapsed">Time Elapsed</option>
					<option value="html">HTML</option>
				</select>
			</label>

			<label>
				<span>Color</span>
				<input type="color" name="color" class="color">
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

			<label class="drilldown-dropdown">
				<span>Destination Report</span>
			</label>

			<footer class="show">

				<button type="button" class="cancel">
					<i class="far fa-times-circle"></i> Cancel
				</button>

				<button type="submit" class="apply">
					<i class="fas fa-check"></i> Apply
				</button>

				<button type="button" class="save">
					<i class="far fa-save"></i> Save
				</button>
			</footer>
		`;

		form.on('submit', async e => this.apply(e));
		form.on('click', async e => e.stopPropagation());

		if(!user.privileges.has('report'))
			form.querySelector('footer .save').classList.add('hidden');

		form.elements.formula.on('keyup', async () => {

			if(formulaTimeout)
				clearTimeout(formulaTimeout);

			formulaTimeout = setTimeout(() => this.validateFormula(), 200);
		});

		form.insertBefore(this.columnFilters.container, form.querySelector('.columnType'));
		form.insertBefore(this.columnAccumulations.container, form.querySelector('.columnType'));

		form.querySelector('.cancel').on('click', () => {

			this.dialogueBox.hide();

			if(!form.parentElement.classList.contains('body'))
				form.parentElement.classList.add('hidden');
		});

		form.querySelector('.save').on('click', () => this.save());

		return form;
	}

	get dialogueBox() {

		if(this.dialogueBoxObject)
			return this.dialogueBoxObject;

		const dialogue = this.dialogueBoxObject = new DialogBox();

		dialogue.container.classList.add('data-source-column');
		dialogue.heading = 'Column Properties';

		const sortedReports = Array.from(DataSource.list.values()).sort((a, b) => {

			const
				nameA = a.name.toUpperCase(),
				nameB = b.name.toUpperCase();

			if(nameA < nameB)
				return -1;

			if(nameA > nameB)
				return 1;

			return 0;
		});

		const list = [];

		for(const report of sortedReports)
			list.push({name: report.name, value: report.query_id});

		this.drilldownQuery = new MultiSelect({datalist: list, multiple: false, expand: true});

		this.form.querySelector('.drilldown-dropdown').appendChild(this.drilldownQuery.container);


		this.drilldownParameters = new DataSourceColumnDrilldownParameters(this);

		this.form.insertBefore(this.drilldownParameters.container, this.form.querySelector('.drilldown-dropdown').nextElementSibling);

		this.drilldownQuery.on('change', () => {

			if(this.drilldownQuery.value.length && parseInt(this.drilldownQuery.value[0]) != this.drilldown.query_id)
				this.drilldownParameters.clear();

			this.drilldownParameters.load()
		});

		dialogue.body.appendChild(this.form);

		return dialogue;
	}

	async apply(e) {

		if(e)
			e.preventDefault();

		for(const element of this.form.elements)
			this[element.name] = element.value == '' ? null : element.value || null;

		this.filters = this.columnFilters.json;

		this.disabled = parseInt(this.disabled) || 0;

		this.container.querySelector('.label .name').textContent = this.name;
		this.container.querySelector('.label .color').style.background = this.color;

		if(!this.form.parentElement.classList.contains('body'))
			this.form.parentElement.classList.add('hidden');

		if(this.sort != -1)
			this.source.columns.sortBy = this;

		await this.source.visualizations.selected.render();

		this.dialogueBox.hide();

		new SnackBar({
			message: `Changes to <em>${this.name}</em> Applied`,
			subtitle: 'Changes are not saved yet and will be reset when the page reloads.',
		});
	}

	async save() {

		if(!this.source.format)
			this.source.format = {};

		if(!this.source.format.columns)
			this.source.format.columns = [];

		let
			response,
			updated = 0;

		for(const element of this.form.elements)
			this[element.name] = isNaN(element.value) ? element.value || null : element.value == '' ? null : parseFloat(element.value);

		this.filters = this.columnFilters.json;

		response = {
			key : this.key,
			name : this.name,
			type : this.form.querySelector('.columnType select').value,
			disabled : this.disabled,
			color : this.color,
			searchType : this.searchType,
			filters : this.filters,
			sort : this.sort,
			prefix : this.prefix,
			postfix : this.postfix,
			formula : this.formula,
			drilldown : {
				query_id : parseInt(this.drilldownQuery.value[0]) || 0,
				parameters : this.drilldownParameters.json
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

		try {

			await API.call('reports/report/update', parameters, options);

			await this.source.visualizations.selected.load();

			this.dialogueBox.hide();

			new SnackBar({
				message: `Changes to <em>${this.name}</em> Saved`,
				subtitle: 'These changes will persist across page reloads.',
			});

		} catch(e) {

			new SnackBar({
				message: 'Request Failed',
				subtitle: e.message,
				type: 'error',
			});
		}
	}

	async update() {

		this.render();

		this.source.columns.render();
		await this.source.visualizations.selected.render();
	}

	render() {

		this.container.classList.toggle('hidden', this.hidden ? true : false);

		this.container.querySelector('.label .name').textContent = this.name;

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

		await Promise.all(Array.from(destination.filters.values()).map(f => f.fetch()));

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

		destination.drilldown = Object.assign({}, this.drilldown);
		destination.drilldown.parent = this.source;

		destination.container.setAttribute('style', this.source.container.getAttribute('style'));

		const parent = this.source.container.parentElement;

		parent.removeChild(this.source.container);
		parent.appendChild(destination.container);

		destination.container.querySelector('.drilldown').classList.remove('hidden');

		destination.visualizations.selected.load();
	}
}

class DataSourceColumnDrilldownParameters extends Set {

	constructor(column) {

		super();

		this.column = column;

		this.column.drilldown = this.column.drilldown || {};

		for(const paramter of this.column.drilldown.parameters || []) {

			this.add(new DataSourceColumnDrilldownParameter(paramter, this));
		}
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('drilldown-parameters');

		container.innerHTML = `
			<label>
				<span>Parameters</span>
				<button type="button" class="add-parameters"><i class="fa fa-plus"></i> Add New</button>
			</label>
			<div class="parameter-list"></div>
		`;

		container.querySelector('.add-parameters').on('click', () => {

			this.add(new DataSourceColumnDrilldownParameter({}, this));
			this.load();
		});

		this.load();

		return container;

	}

	load() {

		const
			parameterList = this.container.querySelector('.parameter-list'),
			report = DataSource.list.get(parseInt(this.column.drilldownQuery.value[0]));

		parameterList.textContent = null;

		if(!this.size) {

			parameterList.innerHTML = '<div class="NA">No parameters added.</div>';
		}
		else {

			for(const paramter of this.values())
				parameterList.appendChild(paramter.container);
		}

		this.container.querySelector('.add-parameters').parentElement.classList.toggle('hidden', !report || !report.filters.length);
		this.update();

	}

	update(updatingType) {

		const
			parameterList = this.container.querySelector('.parameter-list'),
			report = DataSource.list.get(parseInt(this.column.drilldownQuery.value[0]));

		if(report && report.filters.length) {

			for(const parameter of this.values()) {

				parameter.update(updatingType);
			}
		}
		else {

			parameterList.innerHTML = '<div class="NA">No filters present in the selected report.</div>';
		}
	}

	get json() {

		const json = [];

		for(const parameter of this.values()) {

			json.push(parameter.json)

		}

		return json;
	}
}

class DataSourceColumnDrilldownParameter {

	constructor(parameter, columnDrillDown) {

		Object.assign(this, parameter);

		this.columnDrilldown = columnDrillDown;
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.innerHTML = `
			<label>
				<span>Destination Filter</span>
				<select name="placeholder" value="${this.placeholder || ''}"></select>
			</label>

			<label>
				<span>Source Type</span>
				<select name="type" value="${this.type || ''}">
					<option value="column">Column</option>
					<option value="filter">Filter</option>
					<option value="static">Custom</option>
				</select>
			</label>

			<label>
				<span>Source Value</span>
				<select name="value" value="${this.value || ''}"></select>
				<input name="value" value="${this.value || ''}" class="hidden">
			</label>

			<label>
				<span>&nbsp;</span>
				<button type="button" class="delete">
					<i class="far fa-trash-alt"></i> Delete
				</button>
			</label>
		`;

		container.classList.add('parameter');

		container.querySelector('select[name=type]').on('change', () => this.update(true));

		container.querySelector('.delete').on('click', () => {

			this.columnDrilldown.delete(this);
			this.columnDrilldown.load();
		});

		return container;

	}

	update(updatingType) {

		const
			placeholder = this.container.querySelector('select[name=placeholder]'),
			type = this.container.querySelector('select[name=type]'),
			report = DataSource.list.get(parseInt(this.columnDrilldown.column.drilldownQuery.value[0]));

		let
			value = this.container.querySelector('select[name=value]'),
			placeholderValue = placeholder.value || placeholder.getAttribute('value');

		value.classList.remove('hidden');
		this.container.querySelector('input[name=value]').classList.add('hidden');


		placeholder.textContent = null;

		for(const filter of report.filters)
			placeholder.insertAdjacentHTML('beforeend', `<option value="${filter.placeholder}">${filter.name}</option>`);

		if(placeholderValue)
			placeholder.value = placeholderValue;

		if(!updatingType && type.getAttribute('value'))
			type.value = type.getAttribute('value');

		value.textContent = null;

		if(type.value == 'column') {

			for(const column of this.columnDrilldown.column.source.columns.list.values())
				value.insertAdjacentHTML('beforeend', `<option value="${column.key}">${column.name}</option>`);
		}

		else if(type.value == 'filter') {

			for(const filter of this.columnDrilldown.column.source.filters.values())
				value.insertAdjacentHTML('beforeend', `<option value="${filter.placeholder}">${filter.name}</option>`);
		}
		else {
			value.classList.add('hidden');
			value = this.container.querySelector('input[name=value]');
			value.classList.remove('hidden');
		}

		if(value.getAttribute('value'))
			value.value = value.getAttribute('value');
	}

	get json() {

		return {
			placeholder: this.container.querySelector('select[name=placeholder]').value,
			type: this.container.querySelector('select[name=type]').value,
			value: this.container.querySelector('select[name=value]').classList.contains('hidden') ? this.container.querySelector('input[name=value]').value : this.container.querySelector('select[name=value]').value
		}
	}
}

class DataSourceColumnFilters extends Set {

	constructor(column) {

		super();

		this.column = column;
		const filters = this.column.filters && this.column.filters.length ? this.column.filters : [{name: '0', value: ''}];

		for(const filter of filters)
			this.add(new DataSourceColumnFilter(filter, this));
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('show', 'filters');

		container.innerHTML = `
			<span>
				Search
				<button type="button" class="show add-filter add-new-item"><i class="fa fa-plus"></i></button>
			</span>
			<div class="list"></div>
		`;

		container.querySelector('button.add-filter').on('click', () => {

			this.add(new DataSourceColumnFilter({name: '0', value: ''}, this));
			this.render();
		});

		this.render();

		return container;
	}

	render() {

		const div = this.container.querySelector('.list');

		div.textContent = null;

		for(const filter of this)
			div.appendChild(filter.container);

		if(!this.size) {
			div.innerHTML = '<div class="NA">No Filters Added</div>'
		}
	}

	get json() {

		const json = [];

		for(const filter of this) {
			if(filter.json.value != '')
				json.push(filter.json);
		}

		return json;
	}
}

class DataSourceColumnFilter {

	static setup() {

		DataSourceColumnFilter.types = [
			{
				slug: 'contains',
				name: 'Contains',
				apply: (q, v) => v.toString().toLowerCase().includes(q.toString().toLowerCase()),
			},
			{
				slug: 'notcontains',
				name: 'Not Contains',
				apply: (q, v) => !v.toString().toLowerCase().includes(q.toString().toLowerCase()),
			},
			{
				slug: 'startswith',
				name: 'Starts With',
				apply: (q, v) => v.toString().toLowerCase().startsWith(q.toString().toLowerCase()),
			},
			{
				slug: 'endswith',
				name: 'Ends With',
				apply: (q, v) => v.toString().toLowerCase().endsWith(q.toString().toLowerCase()),
			},
			{
				slug: 'equalto',
				name: '=',
				apply: (q, v) => v.toString().toLowerCase() == q.toString().toLowerCase(),
			},
			{
				slug: 'notequalto',
				name: '!=',
				apply: (q, v) => v.toString().toLowerCase() != q.toString().toLowerCase(),
			},
			{
				slug: 'greaterthan',
				name: '>',
				apply: (q, v) => v > q,
			},
			{
				slug: 'lessthan',
				name: '<',
				apply: (q, v) => v < q,
			},
			{
				slug: 'greaterthanequalsto',
				name: '>=',
				apply: (q, v) => v >= q,
			},
			{
				slug: 'lessthanequalto',
				name: '<=',
				apply: (q, v) => v <= q,
			},
			{
				slug: 'regularexpression',
				name: 'RegExp',
				apply: (q, v) => q.toString().match(new RegExp(q, 'i')),
			},
		];
	}

	constructor(filter, filters) {

		Object.assign(this, filter);

		 this.filters = filters;
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('label');

		container.classList.add('search-type');

		container.innerHTML = `
			<div class="category-group search">
				<select class="searchType"></select>
				<input type="search" class="searchQuery">
				<button type="button" class="delete"><i class="far fa-trash-alt"></i></button>
			</div>
		`;

		for(const filter of DataSourceColumnFilter.types) {
			container.querySelector('select.searchType').insertAdjacentHTML('beforeend', `
				<option value="${filter.slug}">
					${filter.name}
				</option>
			`);
		}

		if(this.slug)
			container.querySelector('select').value = this.slug;

		container.querySelector('input').value = this.value;

		container.querySelector('.delete').on('click', () => {

			this.filters.delete(this);
			this.filters.render();
		});

		return container;
	}

	get json() {

		return {
			slug: this.container.querySelector('select').value,
			value: this.container.querySelector('input').value,
		};
	}
}

class DataSourceColumnAccumulations extends Set {

	constructor(column) {

		super();

		this.column = column;
		this.accumulations =[{name:'', value:''}];

		for(const accumulation of this.accumulations)
			this.add(new DataSourceColumnAccumulation(accumulation, this));
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('show', 'accumulations');

		container.innerHTML = `
			<span>
				Accumulation
				<button type="button" class="show add-accumulation add-new-item"><i class="fa fa-plus"></i></button>
			</span>
			<div class="list"></div>
		`;

		container.querySelector('button.add-accumulation').on('click', () => {

			this.add(new DataSourceColumnAccumulation({name:'', value:''}, this));
			this.render();
		});

		this.render();

		return container;
	}

	render() {

		const div = this.container.querySelector('.list');

		div.textContent = null;

		for(const accumulation of this)
			div.appendChild(accumulation.container);

		if(!this.size) {
			div.innerHTML = '<div class="NA">No Accumulation Added</div>'
		}
	}
}

class DataSourceColumnAccumulation {

	static setup() {

		DataSourceColumnAccumulation.accumulationTypes = [
			{
				slug: 'sum',
				name: 'Sum',
				apply: (rows, column) => Format.number(rows.reduce((c, r) => c + (parseFloat(r.get(column)) || 0), 0)),
			},
			{
				slug: 'average',
				name: 'Average',
				apply: (rows, column) => Format.number(rows.reduce((c, r) => c + (parseFloat(r.get(column)) || 0), 0) / rows.length),
			},
			{
				slug: 'max',
				name: 'Max',
				apply: (rows, column) => Format.number(Math.max(...rows.map(r => parseFloat(r.get(column)) || 0))),
			},
			{
				slug: 'min',
				name: 'Min',
				apply: (rows, column) => Format.number(Math.min(...rows.map(r => parseFloat(r.get(column)) || 0))),
			},
			{
				slug: 'distinctcount',
				name: 'Distinct Count',
				apply: (rows, column) => Format.number(new Set(rows.map(r => r.get(column))).size),
				string: true,
			},
			{
				slug: 'distinctvalues',
				name: 'Distinct Values',
				apply: (rows, column) => Array.from(new Set(rows.map(r => r.get(column)))).join(', '),
				string: true,
			},
		];
	}

	constructor(accumulation, accumulations) {

		Object.assign(this, accumulation);

		this.accumulations = accumulations;
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('label');

		container.classList.add('accumulation-type');

		container.innerHTML = `
			<div class="category-group">
				<select class="accumulation-content"></select>
				<input type="text" readonly>
				<button type="button" class="delete"><i class="far fa-trash-alt"></i></button>
			</div>
		`;

		const select = container.querySelector('.accumulation-content');

		select.insertAdjacentHTML('beforeend', `<option value="-1">Select</option>`);

		for(const [i, type] of DataSourceColumnAccumulation.accumulationTypes.entries())
			select.insertAdjacentHTML('beforeend', `<option value="${i}">${type.name}</option>`);

		select.querySelector('option').selected = true;

		if(select.value != '-1')
			this.run();

		select.on('change', () => this.run());

		container.querySelector('.delete').on('click', () => {

			this.accumulations.delete(this);
			this.accumulations.render();
		});

		return container
	}

	async run() {

		const select = this.container.querySelector('select');

		const accumulation = DataSourceColumnAccumulation.accumulationTypes[select.value];

		if(accumulation)
			this.container.querySelector('input').value = accumulation.apply(await this.accumulations.column.source.response(), this.accumulations.column.key);

		else this.container.querySelector('input').value = '';
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
			processors = document.createElement('div');

		processors.classList.add('item');

		processors.classList.toggle('hidden', this.timingColumn ? false : true);

		processors.innerHTML =`
			<div class="label postprocessors">
				<i class="fas fa-wrench"></i>
				<div>Functions</div>
			</div>
			<div class="submenu"></div>
		`;

		const submenu = processors.querySelector('.submenu');

		for(const processor of this.list.values())
			submenu.appendChild(processor.container);

		container.appendChild(processors);

		return container;
	}

	update() {

		this.timingColumn = this.source.columns.get('timing');

		for(const column of this.source.columns.values()) {
			if(column.type == 'date')
				this.timingColumn = column;
		}

		const label = this.source.container.querySelector('.postprocessors');

		if(!label)
			return;

		label.parentElement.classList.toggle('hidden', this.timingColumn ? false : true);
	}

	render() {

		const label = this.source.container.querySelector('.postprocessors');

		if(!label)
			return;

		for(const selected of label.parentElement.querySelectorAll('.item.selected'))
			selected.classList.remove('selected');

		if(!this.selected)
			return this.list.get('Orignal').container.classList.add('selected');

		for(const item of this.selected.container.querySelectorAll('.submenu .item'))
			item.classList.toggle('selected', this.selected.value == item.dataset.value);

		this.selected.container.classList.add('selected');
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

		const container = this.containerElement = document.createElement('div');

		container.classList.add('item');

		container.innerHTML = `
			<div class="label">
				<span class="no-icon">${this.name}</span>
			</div>
			<div class="submenu"></div>
		`;

		if(this.key == 'Orignal') {

			container.querySelector('.label').on('click', () => {

				delete this.source.postProcessors.selected;

				this.source.visualizations.selected.render();
				this.source.postProcessors.render();
			});
		}

		const submenu = container.querySelector('.submenu');

		for(const [value, name] of this.domain) {

			const item = document.createElement('div');

			item.classList.add('item');

			item.innerHTML = `
				<div class="label">
					<div class="no-icon">${name}</div>
				</div>
			`;

			item.dataset.value = value;

			item.on('click', () => {

				this.source.postProcessors.selected = this;
				this.source.postProcessors.selected.value = value;

				this.source.visualizations.selected.render();
				this.source.postProcessors.render();
			});

			submenu.appendChild(item);
		}

		return container;
	}
}

class DataSourceTransformations extends Set {

	constructor(source) {

		super();

		this.source = source;
	}

	async run(response) {

		this.clear();

		const
			visualization = this.source.visualizations.selected,
			transformations = visualization.options && visualization.options.transformations ? visualization.options.transformations : [];

		for(const transformation of transformations) {

			if(DataSourceTransformation.types.has(transformation.type))
				this.add(new (DataSourceTransformation.types.get(transformation.type))(transformation, this.source));
		}

		response = JSON.parse(JSON.stringify(response));

		for(const transformation of this)
			response = await transformation.run(response);

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

		Object.assign(this, transformation);
	}
}

DataSourceTransformation.types = new Map;

DataSourceTransformation.types.set('pivot', class DataSourceTransformationPivot extends DataSourceTransformation {

	async run(response = []) {

		if(!response || !response.length)
			return response;

		const
			[{column: groupColumn}] = this.columns && this.columns.length ? this.columns : [{}],
			columns = new Set,
			rows = new Map;

		if(groupColumn) {

			for(const row of response) {
				if(!columns.has(row[groupColumn]))
					columns.add(row[groupColumn]);
			}
		}

		for(const responseRow of response) {

			let key = {};

			for(const row of this.rows || [])
				key[row.column] = responseRow[row.column];

			key = JSON.stringify(key);

			if(!rows.get(key))
				rows.set(key, new Map);

			const row = rows.get(key);

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

					if(!row.has(value.name || value.column))
						row.set(value.name || value.column, []);

					row.get(value.name || value.column).push(responseRow[value.column])
				}
			}
		}

		const newResponse = [];

		for(const [key, row] of rows) {

			const
				newRow = {},
				keys = JSON.parse(key);

			for(const key in keys)
				newRow[key] = keys[key];

			for(const [groupColumnValue, values] of row) {

				let
					value = null,
					function_ = null;

				if(groupColumn)
					function_ = this.values[0].function;

				else {

					for(const value of this.values) {
						if((value.name || value.column) == groupColumnValue)
							function_ = value.function;
					}
				}

				switch(function_) {

					case 'sum':
						value = values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
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
						value = Math.floor(values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0) / values.length * 100) / 100;
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
});

DataSourceTransformation.types.set('filters', class DataSourceTransformationPivot extends DataSourceTransformation {

	async run(response = []) {

		if(!response || !response.length || !this.filters || !this.filters.length)
			return response;

		const newResponse = [];

		for(const row of response) {

			let status = true;

			for(const _filter of this.filters) {

				const [filter] = DataSourceColumnFilter.types.filter(f => f.slug == _filter.function);

				if(!filter)
					continue;

				if((!_filter.column in row))
					continue;

				if(!filter.apply(_filter.value, row[_filter.column]))
					status = false;
			}

			if(status)
				newResponse.push(row);
		}

		return newResponse;
	}
});

DataSourceTransformation.types.set('stream', class DataSourceTransformationPivot extends DataSourceTransformation {

	async run(response = []) {

		if(!response || !response.length)
			return response;

		if(!this.visualization_id)
			return this.source.error('Stream visualization not selected!');

		let report = null;

		for(const _report of DataSource.list.values()) {

			const [visualization] = _report.visualizations.filter(v => v.visualization_id == this.visualization_id);

			if(!visualization)
				continue;

			report = new DataSource(_report);
			break;
		}

		if(!report)
			return this.source.error('Stream visualization not found!');

		[report.visualizations.selected] = report.visualizations.filter(v => v.visualization_id == this.visualization_id)

		await report.fetch();

		const streamResponse = await report.response();

		const
			newResponse = [],
			newColumns = Array.from(streamResponse[0].keys()),
			filters = {};

		for(const filter of DataSourceColumnFilter.types)
			filters[filter.slug] = filter;

		for(const row of response) {

			for(const newColumn of newColumns) {

				// If the stream's column doesn't exists in base report then add it
				if(!(newColumn in row))
					row[newColumn] = [];
			}

			for(const streamRow of streamResponse) {

				let matched = true;

				for(const join of this.joins) {

					if(!filters[join.function].apply(row[join.sourceColumn], streamRow.get(join.streamColumn))) {
						matched = false;
						break
					}
				}

				if(!matched)
					continue;

				for(const [key, value] of streamRow) {

					const array = row[key];

					if(Array.isArray(array))
						array.push(value);
				}
			}

			for(const key in row) {

				const [column] = this.columns.filter(c => c.column == key);

				if(!column) {
					delete row[key];
					continue;
				}

				const values = row[key];

				if(!Array.isArray(values))
					continue;

				let value = null;

				switch(column.function) {

					case 'sum':
						value = values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
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
						value = Math.floor(values.reduce((sum, value) => sum + (parseFloat(value) || 0), 0) / values.length * 100) / 100;
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

				row[key] = value;
			}
		}

		return response;
	}
});

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

		const timingColumn = this.source.postProcessors.timingColumn;

		if(!timingColumn)
			return response;

		return response.filter(r => new Date(r.get(timingColumn.key)).getDay() == this.value)
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

		const timingColumn = this.source.postProcessors.timingColumn;

		if(!timingColumn)
			return response;

		const result = new Map;

		for(const row of response) {

			let period;

			const periodDate = new Date(row.get(timingColumn.key));

			// Week starts from monday, not sunday
			if(this.value == 'week')
				period = periodDate.getDay() ? periodDate.getDay() - 1 : 6;

			else if(this.value == 'month')
				period = periodDate.getDate() - 1;

			const timing = new Date(Date.parse(row.get(timingColumn.key)) - period * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);

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

			newRow.set(timingColumn.key, row.get(timingColumn.key));
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

		const timingColumn = this.source.postProcessors.timingColumn;

		if(!timingColumn)
			return response;

		const
			result = new Map,
			copy = new Map;

		for(const row of response)
			copy.set(Date.parse(row.get(timingColumn.key)), row);

		for(const [timing, row] of copy) {

			if(!result.has(timing)) {

				result.set(timing, new DataSourceRow(null, this.source));

				let newRow = result.get(timing);

				for(const key of row.keys())
					newRow.set(key, 0);
			}

			const newRow = result.get(timing);

			for(let i = 0; i < this.value; i++) {

				const element = copy.get(timing - i * 24 * 60 * 60 * 1000);

				if(!element)
					continue;

				for(const [key, value] of newRow)
					newRow.set(key,  value + (element.get(key) / this.value));
			}

			newRow.set(timingColumn.key, row.get(timingColumn.key));
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

		const timingColumn = this.source.postProcessors.timingColumn;

		if(!timingColumn)
			return response;

		const
			result = new Map,
			copy = new Map;

		for(const row of response)
			copy.set(Date.parse(row.get(timingColumn.key)), row);

		for(const [timing, row] of copy) {

			if(!result.has(timing)) {

				result.set(timing, new DataSourceRow(null, this.source));

				let newRow = result.get(timing);

				for(const key of row.keys())
					newRow.set(key, 0);
			}

			const newRow = result.get(timing);

			for(let i = 0; i < this.value; i++) {

				const element = copy.get(timing - i * 24 * 60 * 60 * 1000);

				if(!element)
					continue;

				for(const [key, value] of newRow)
					newRow.set(key,  value + element.get(key));
			}

			newRow.set(timingColumn.key, row.get(timingColumn.key));
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

		if(this.options && typeof this.options == 'string') {
			try {
				this.options = JSON.parse(this.options);
			} catch(e) {}
		}

		for(const key in this.options)
			this[key] = this.options[key];
	}

	render() {

		this.source.container.querySelector('h2 .title').textContent = this.name;

		const visualizationToggle = this.source.container.querySelector('header .change-visualization');

		if(visualizationToggle)
			visualizationToggle.value = this.source.visualizations.indexOf(this);

		this.source.container.removeChild(this.source.container.querySelector('.visualization'));

		this.source.visualizations.selected = this;

		this.source.container.appendChild(this.container);
		this.source.container.querySelector('.columns').classList.remove('hidden');

		const configure = this.source.container.querySelector('.menu .configure-visualization');

		if(configure) {

			if(this.visualization_id)
				configure.href = `/reports/configure-visualization/${this.visualization_id}`;

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

	async draw() {

		const rows = await this.source.response();

		if(!rows || !rows.length)
			return this.source.error();

		if(!this.axes)
			return this.source.error('Axes not defined.');

		for(const axis of this.axes) {

			if(!axis.restcolumns)
				continue;

			axis.columns = [];

			for(const key of this.source.columns.keys()) {

				if(!this.axes.some(a => a.columns.some(c => c.key == key)))
					axis.columns.push({key});
			}

			axis.column = axis.columns.length ? axis.columns[0].key : '';
		}

		if(!this.axes.bottom)
			return this.source.error('Bottom axis not defined.');

		if(!this.axes.left)
			return this.source.error('Left axis not defined.');

		if(!this.axes.bottom.columns.length)
			return this.source.error('Bottom axis requires exactly one column.');

		if(!this.axes.left.columns.length)
			return this.source.error('Left axis requires atleast one column.');

		if(this.axes.bottom.columns.length > 1)
			return this.source.error('Bottom axis cannot has more than one column.');

		for(const column of this.axes.bottom.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Bottom axis column <em>${column.key}</em> not found.`);
		}

		for(const column of this.axes.left.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Left axis column <em>${column.key}</em> not found.`);
		}

		for(const bottom of this.axes.bottom.columns) {
			for(const left of this.axes.left.columns) {

				if(bottom.key == left.key)
					return this.source.error(`Column <em>${bottom.key}</em> cannot be on both axis.`);
			}
		}

		for(const [key, column] of this.source.columns) {

			if(this.axes.left.columns.some(c => c.key == key) || (this.axes.right && this.axes.right.columns.some(c => c.key == key)) || this.axes.bottom.columns.some(c => c.key == key))
				continue;

			column.hidden = true;
			column.disabled = true;
			column.render();
		}

		this.source.columns.overFlow();

		for(const column of this.axes.bottom.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Bottom axis column <em>${column.key}</em> not found.`);
		}

		if(this.axes.bottom.columns.every(c => this.source.columns.get(c.key).disabled))
			return this.source.error('Bottom axis requires atleast one column.');

		if(this.axes.left.columns.every(c => this.source.columns.get(c.key).disabled))
			return this.source.error('Left axis requires atleast one column.');

		this.axes.bottom.height = 25;
		this.axes.left.width = 50;

		if(this.axes.bottom.label)
			this.axes.bottom.height += 20;

		if(this.axes.left.label)
			this.axes.left.width += 20;

		this.height = this.container.clientHeight - this.axes.bottom.height - 20;
		this.width = this.container.clientWidth - this.axes.left.width - 40;

		for(const row of rows) {
			for(const [key, column] of row)
				row.set(key, row.getTypedValue(key));
		}

		this.rows = rows;
		this.originalLength = rows.length;

		window.addEventListener('resize', () => {

			const
				height = this.container.clientHeight - this.axes.bottom.height - 20,
				width = this.container.clientWidth - this.axes.left.width - 40;

			if(this.width != width || this.height != height) {

				this.width = width;
				this.height = height;

				this.plot({resize: true});
			}
		});
	}

	plot(options = {}) {

		const container = d3.selectAll(`#visualization-${this.id}`);

		container.selectAll('*').remove();

		if(!this.rows)
			return;

		if(!this.axes)
			return this.source.error('Bottom axis not defined.');

		this.columns = {};

		for(const row of this.rows) {

			for(const [key, _] of row) {

				if(key == this.axes.bottom.column)
					continue;

				if((!this.axes.left || !this.axes.left.columns.some(c => c.key == key)) && (!this.axes.right || !this.axes.right.columns.some(c => c.key == key)))
					continue;

				const column = this.source.columns.get(key);

				if(!column || column.disabled)
					continue;

				if(!this.columns[key]) {
					this.columns[key] = [];
					Object.assign(this.columns[key], column);
				}

				this.columns[key].push({
					x: row.get(this.axes.bottom.column),
					y: row.get(key),
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

		if(!this.rows.length)
			return this.source.error();

		if(this.rows.length != this.originalLength) {

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
			resetZoom.on('click', async () => {

				const rows = await this.source.response();

				for(const row of rows) {
					for(const [key, column] of row)
						row.set(key, row.getTypedValue(key));
				}

				this.rows = rows;

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
					filteredRows = [],
					width = Math.abs(mouse[0] - 10 - that.zoomRectangle.origin[0]);

				for(const row of that.rows) {

					const item = that.x(row.get(that.axes.bottom.column)) + that.axes.left.width + 10;

					if(
						(mouse[0] < that.zoomRectangle.origin[0] && item >= mouse[0] && item <= that.zoomRectangle.origin[0]) ||
						(mouse[0] >= that.zoomRectangle.origin[0] && item <= mouse[0] && item >= that.zoomRectangle.origin[0])
					)
						filteredRows.push(row);
				}

				// Assign width and height to the rectangle
				that.zoomRectangle
					.select('rect')
					.attr('x', Math.min(that.zoomRectangle.origin[0], mouse[0] - 10))
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

			for(const [key, _] of row) {

				if(key == that.axes.bottom.column)
					continue;

				const column = row.source.columns.get(key);

				if(column.disabled)
					continue;

				tooltip.push(`
					<li class="${row.size > 2 && that.hoverColumn && that.hoverColumn.key == key ? 'hover' : ''}">
						<span class="circle" style="background:${column.color}"></span>
						<span>
							${column.drilldown && column.drilldown.query_id ? '<i class="fas fa-angle-double-down"></i>' : ''}
							${column.name}
						</span>
						<span class="value">${Format.number(row.get(key))}</span>
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
			that.zoomRectangle.origin[0] -= 10;
			that.zoomRectangle.origin[1] -= 10;
		})

		.on('mouseup', function() {

			if(!that.zoomRectangle)
				return;

			that.zoomRectangle.remove();

			const
				mouse = d3.mouse(this),
				width = Math.abs(that.zoomRectangle.origin[0] - mouse[0]),
				filteredRows = that.rows.filter(row => {

					const item = that.x(row.get(that.axes.bottom.column)) + that.axes.left.width + 10;

					if(mouse[0] < that.zoomRectangle.origin[0])
						return item >= mouse[0] && item <= that.zoomRectangle.origin[0];
					else
						return item <= mouse[0] && item >= that.zoomRectangle.origin[0];
				});

			that.zoomRectangle = null;

			// Width check to make sure the zoom rectangle has substantial width
			if(filteredRows.length < 2 || width <= 10)
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
		this.selectedRows = new Set;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `
			<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
		`;

		await this.source.fetch(options);

		await this.render(options);
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

	async render(options = {}) {

		const
			container = this.container.querySelector('.container'),
			rows = await this.source.response();

		container.textContent = null;

		const
			table = document.createElement('table'),
			thead = document.createElement('thead'),
			search = document.createElement('tr'),
			headings = document.createElement('tr'),
			rowCount = document.createElement('div');

		search.classList.add('search');

		for(const column of this.source.columns.list.values()) {

			const container = document.createElement('th');

			container.classList.add('heading');

			container.innerHTML = `
				<div>
					<span class="name">
						${column.drilldown && column.drilldown.query_id ? '<span class="drilldown"><i class="fas fa-angle-double-down"></i></span>' : ''}
						${column.name}
					</span>
					<div class="filter-popup"><span>&#9698;</span></div>
					<div class="hidden popup-dropdown"></div>
				</div>
			`;

			document.querySelector('body').on('click', () => {
				container.querySelector('.popup-dropdown').classList.add('hidden')
				container.querySelector('.filter-popup span').classList.remove('open');
			});

			container.on('click', () => {

				if(parseInt(column.sort) == 1)
					column.sort = 0;

				else column.sort = 1;

				column.source.columns.sortBy = column;
				column.source.visualizations.selected.render();
			});

			container.querySelector('.filter-popup').on('click', e => {

				column.dialogueBox;

				e.stopPropagation();

				for(const key in column) {

					if(key in column.form)
						column.form[key].value = column[key];
				}

				for(const node of container.parentElement.querySelectorAll('th')) {
					node.querySelector('.popup-dropdown').classList.add('hidden');
					node.querySelector('.filter-popup span').classList.remove('open');
				}

				e.currentTarget.querySelector('span').classList.add('open');

				column.form.classList.add('compact');

				container.querySelector('.popup-dropdown').appendChild(column.form);

				container.querySelector('.popup-dropdown').classList.remove('hidden');
			});

			const accumulations = column.form.querySelectorAll('.accumulation-type');

			if(column.columnAccumulations.size) {

				for(const accumulation of column.columnAccumulations) {
					accumulation.run();
				}
			}

			if(column.filters && column.filters.length && !column.filters.some(f => f.value == ''))
				container.classList.add('has-filter');

			headings.appendChild(container);
		}

		if(!this.hideHeadingsBar)
			thead.appendChild(headings);

		if(thead.children.length)
			table.appendChild(thead);

		const tbody = document.createElement('tbody');

		for(const [position, row] of rows.entries()) {

			if(position >= this.rowLimit)
				break;

			const tr = row.tr = document.createElement('tr');

			for(const [key, column] of this.source.columns.list) {

				const td = document.createElement('td');

				let rowJson = row.get(key);

				if(column.type == 'html') {

					td.innerHTML = row.getTypedValue(key);
				}
				else if(rowJson && typeof rowJson == 'object') {

					td.innerHTML = `
						<span class="value">${Array.isArray(rowJson) ? '[ Array: ' + rowJson.length + ' ]' : '{ Object: ' + Object.keys(rowJson).length + ' }'}</span>
					`;

					td.classList.add('json');

					const tdValue = td.querySelector('.value');

					td.on('click', () => {

						tdValue.classList.add('hidden');

						if(td.editorContainer) {

							td.appendChild(td.editorContainer);
							return;
						}

						td.editorContainer = document.createElement('div');

						td.editorContainer.innerHTML = `
							<span class="close" title="Close"><i class="fa fa-times"></i></span>
						`;

						const editor = new CodeEditor({mode: 'json'});

						editor.editor.setTheme('ace/theme/clouds');
						td.editorContainer.appendChild(editor.container);

						editor.value = JSON.stringify(rowJson, 0 , 4);

						td.editorContainer.on('click', e => e.stopPropagation());

						td.editorContainer.querySelector('.close').on('click', e => {

							e.stopPropagation();
							td.editorContainer.remove();
							tdValue.classList.remove('hidden');
						});

						td.appendChild(td.editorContainer);
					});
				}
				else {

					td.textContent = row.getTypedValue(key);
				}

				if(column.drilldown && column.drilldown.query_id && DataSource.list.has(column.drilldown.query_id)) {

					td.classList.add('drilldown');
					td.on('click', () => column.initiateDrilldown(row));

					td.title = `Drill down into ${DataSource.list.get(column.drilldown.query_id).name}!`;
				}

				tr.appendChild(td);
			}

			tr.on('click', () => {

				if(this.selectedRows.has(row))
					this.selectedRows.delete(row);

				else this.selectedRows.add(row);

				tr.classList.toggle('selected');

				this.renderRowSummary();
			});

			if(!options.resize) {
				tr.classList.add('initial');
				setTimeout(() => window.requestAnimationFrame(() => tr.classList.remove('initial')), position * 50);
			}

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
				this.source.visualizations.selected.render({resize: true});
			});

			tbody.appendChild(tr);
		}

		if(!rows.length) {
			table.insertAdjacentHTML('beforeend', `
				<tr class="NA"><td colspan="${this.source.columns.size}">${this.source.originalResponse.message || 'No data found!'}</td></tr>
			`);
		}

		rowCount.classList.add('row-summary');

		rowCount.innerHTML = `
			<span class="selected-rows hidden">
				<span class="label">Selected:</span>
				<strong title="Number of selected rows"></strong>
			</span>
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

		if(!this.hideRowSummary && rows.length)
			container.appendChild(rowCount);
	}

	renderRowSummary() {

		if(this.hideRowSummary)
			return;

		const container = this.container.querySelector('.row-summary .selected-rows');

		container.classList.toggle('hidden', !this.selectedRows.size);
		container.querySelector('strong').textContent = Format.number(this.selectedRows.size);
	}
});

Visualization.list.set('line', class Line extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'line');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		await this.render(options);
	}

	async render(options = {}) {

		await this.draw();

		this.plot(options);
	}

	plot(options = {}) {

		super.plot(options);

		if(!this.rows || !this.rows.length)
			return;

		const
			container = d3.selectAll(`#visualization-${this.id}`),
			that = this;

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

		if(['s'].includes(this.axes.bottom.format))
				xAxis.tickFormat(d3.format(this.axes.left.format));

		if(['s'].includes(this.axes.left.format))
				yAxis.tickFormat(d3.format(this.axes.left.format));

		let
			max = null,
			min = null;

		for(const column of this.columns) {

			for(const row of column) {

				if(max == null)
					max = Math.ceil(row.y);

				if(min == null)
					min = Math.floor(row.y);

				max = Math.max(max, Math.ceil(row.y) || 0);
				min = Math.min(min, Math.floor(row.y) || 0);
			}
		}

		this.y.domain([min, max]);
		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangePoints([0, this.width], 0.1, 0);

		const
			biggestTick = this.x.domain().reduce((s, v) => s.length > v.length ? s : v, ''),
			tickNumber = Math.max(Math.floor(this.container.clientWidth / (biggestTick.length * 12)), 1),
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

		//graph type line and
		const
			line = d3.svg
				.line()
				.x(d => this.x(d.x)  + this.axes.left.width)
				.y(d => this.y(d.y));

		//Appending line in chart
		this.svg.selectAll('.line-container')
			.data(this.columns)
			.enter()
			.append('g')
			.attr('class', 'line-container')
			.append('path')
			.attr('class', 'line')
			.attr('d', d => line(d))
			.style('stroke', d => d.color);

		if(this.options.showValues) {

			this.svg
				.append('g')
				.selectAll('g')
				.data(this.columns)
				.enter()
				.append('g')
				.attr('transform', column => `translate(${x1(column.name)}, 0)`)
				.selectAll('text')
				.data(column => column)
				.enter()
				.append('text')
				.attr('width', x1.rangeBand())
				.attr('fill', '#666')
				.attr('x', cell => {

					let value = Format.number(cell.y);

					if(['s'].includes(this.axes.left.format))
						value = d3.format('.4s')(cell.y);

					return this.x(cell.x) + this.axes.left.width + (x1.rangeBand() / 2) - (value.toString().length * 4)
				})
				.text(cell => {

					if(['s'].includes(this.axes.left.format))
						return d3.format('.4s')(cell.y);

					else
						return Format.number(cell.y)
				})
				.attr('y', cell => this.y(cell.y > 0 ? cell.y : 0) - 5)
				.attr('height', cell => Math.abs(this.y(cell.y) - this.y(0)));
		}

		// Selecting all the paths
		const path = this.svg.selectAll('path');

		if(!options.resize) {

			path[0].forEach(path => {
				var length = path.getTotalLength();

				path.style.strokeDasharray = length + ' ' + length;
				path.style.strokeDashoffset = length;
				path.getBoundingClientRect();

				path.style.transition  = `stroke-dashoffset ${Page.animationDuration}ms ease-in-out`;
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
				.classed('drilldown', cell => that.source.columns.get(cell.key).drilldown)
				.attr('id', (_, i) => i)
				.attr('r', 0)
				.style('fill', column.color)
				.attr('cx', d => this.x(d.x) + this.axes.left.width)
				.attr('cy', d => this.y(d.y))
				.on('mouseover', function(cell) {

					if(!that.source.columns.get(cell.key).drilldown)
						return;

					d3.select(this)
						.attr('r', 6)
						.transition()
						.duration(Page.animationDuration)
						.attr('r', 12);

					d3.select(this).classed('hover', 1);
				})
				.on('mouseout', function(cell) {

					if(!that.source.columns.get(cell.key).drilldown)
						return;

					d3.select(this)
						.transition()
						.duration(Page.animationDuration)
						.attr('r', 6);

					d3.select(this).classed('hover', 0);
				})
				.on('click', (cell, row) => {
					that.source.columns.get(cell.key).initiateDrilldown(that.rows[row]);
				});
		}

		container
		.on('mousemove.line', function() {

			container.selectAll('svg > g > circle.clips:not(.hover)').attr('r', 0);

			const
				mouse = d3.mouse(this),
				xpos = parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length)),
				row = that.rows[xpos];

			if(!row || that.zoomRectangle)
				return;

			container.selectAll(`svg > g > circle[id='${xpos}'].clips:not(.hover)`).attr('r', 6);
		})

		.on('mouseout.line', () => container.selectAll('svg > g > circle.clips').attr('r', 0));

		path.on('mouseover', function (d) {
			d3.select(this).classed('line-hover', true);
		});

		path.on('mouseout', function (d) {
			d3.select(this).classed('line-hover', false);
		});
	}
});

Visualization.list.set('bubble', class Bubble extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'bubble');

		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		await this.render(options);
	}

	async render(options = {}) {

		await this.draw();

		this.plot(options);
	}

	plot(options = {}) {

		super.plot(options);

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

		if(['s'].includes(this.axes.bottom.format))
				xAxis.tickFormat(d3.format(this.axes.left.format));

		if(['s'].includes(this.axes.left.format))
				yAxis.tickFormat(d3.format(this.axes.left.format));

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
			biggestTick = this.x.domain().reduce((s, v) => s.length > v.length ? s : v, ''),
			tickNumber = Math.max(Math.floor(this.container.clientWidth / (biggestTick.length * 12)), 1),
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

		const
			line = d3.svg
				.line()
				.x(d => this.x(d.x)  + this.axes.left.width)
				.y(d => this.y(d.y));

		// For each line appending the circle at each point
		for(const column of this.columns) {

			let dots = this.svg
				.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'bubble')
				.attr('id', (_, i) => i)
				.style('fill', column.color)
				.attr('cx', d => this.x(d.x) + this.axes.left.width)
				.attr('cy', d => this.y(d.y));

			if(this.options.showValues) {
				this.svg
					.selectAll('dot')
					.data(column)
					.enter()
					.append('text')
					.attr('x', d => this.x(d.x) + this.axes.left.width - (d.y1.toString().length * 4))
					.attr('y', d => this.y(d.y) + 6)
					.text(d => d.y1);
			}

			if(!options.resize) {

				dots = dots
					.attr('r', d => 0)
					.transition()
					.duration(Page.animationDuration)
					.ease('elastic');
			}

			dots
				.attr('r', d => this.bubble(d.y1));
		}
	}
});

Visualization.list.set('scatter', class Scatter extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'scatter');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		await this.render(options);
	}

	async render(options = {}) {

		await this.draw();

		this.plot(options);
	}

	plot(options = {}) {

		super.plot(options);

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

		if(['s'].includes(this.axes.bottom.format))
				xAxis.tickFormat(d3.format(this.axes.left.format));

		if(['s'].includes(this.axes.left.format))
				yAxis.tickFormat(d3.format(this.axes.left.format));

		let
			max = null,
			min = null;

		for(const column of this.columns) {

			for(const row of column) {

				if(max == null)
					max = Math.ceil(row.y);

				if(min == null)
					min = Math.floor(row.y);

				max = Math.max(max, Math.floor(row.y) || 0);
				min = Math.min(min, Math.ceil(row.y) || 0);
			}
		}

		this.y.domain([min, max]);
		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangePoints([0, this.width], 0.1, 0);

		const
			biggestTick = this.x.domain().reduce((s, v) => s.length > v.length ? s : v, ''),
			tickNumber = Math.max(Math.floor(this.container.clientWidth / (biggestTick.length * 12)), 1),
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

			this.svg
				.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'clips')
				.attr('id', (_, i) => i)
				.attr('r', 3)
				.style('fill', column.color)
				.attr('cx', d => this.x(d.x) + this.axes.left.width)
				.attr('cy', d => this.y(d.y))

			if(this.options.showValues) {
				this.svg
					.selectAll('dot')
					.data(column)
					.enter()
					.append('text')
					.attr('x', d => this.x(d.x) + this.axes.left.width - ((d.x + ', ' + d.y).toString().length * 3))
					.attr('y', d => this.y(d.y) - 12)
					.text(d => d.x + ', ' + d.y);
			}
		}

		container
		.on('mousemove.line', function() {

			container.selectAll('svg > g > circle.clips').attr('r', 3);

			const
				mouse = d3.mouse(this),
				xpos = parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length)),
				row = that.rows[xpos];

			if(!row || that.zoomRectangle)
				return;

			container.selectAll(`svg > g > circle[id='${xpos}'].clips`).attr('r', 6);
		})

		.on('mouseout.line', () => container.selectAll('svg > g > circle.clips').attr('r', 3));
	}
});

Visualization.list.set('bar', class Bar extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'bar');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		await this.source.response();

		await this.render(options);
	}

	async render(options = {}) {

		await this.draw();
		this.plot(options);
	}

	plot(options = {}) {

		super.plot(options);

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

		if(['s'].includes(this.axes.bottom.format))
				xAxis.tickFormat(d3.format(this.axes.left.format));

		if(['s'].includes(this.axes.left.format))
				yAxis.tickFormat(d3.format(this.axes.left.format));

		let
			max = 0,
			min = 0;

		for(const column of this.columns) {

			for(const row of column) {

				if(max == null)
					max = Math.ceil(row.y);

				if(min == null)
					min = Math.floor(row.y);

				max = Math.max(max, Math.floor(row.y) || 0);
				min = Math.min(min, Math.ceil(row.y) || 0);
			}
		}

		this.y.domain([min, max]);

		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangeBands([0, this.width], 0.1, 0);

		const
			biggestTick = this.x.domain().reduce((s, v) => s.length > v.length ? s : v, ''),
			tickNumber = Math.max(Math.floor(this.container.clientWidth / (biggestTick.length * 12)), 1),
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

		let values;

		if(this.options.showValues) {

			values = this.svg
				.append('g')
				.selectAll('g')
				.data(this.columns)
				.enter()
				.append('g')
				.attr('transform', column => `translate(${x1(column.name)}, 0)`)
				.selectAll('text')
				.data(column => column)
				.enter()
				.append('text')
				.attr('width', x1.rangeBand())
				.attr('fill', '#666')
				.attr('x', cell => {

					let value = Format.number(cell.y);

					if(['s'].includes(this.axes.left.format))
						value = d3.format('.4s')(cell.y);

					return this.x(cell.x) + this.axes.left.width + (x1.rangeBand() / 2) - (value.toString().length * 4)
				})
				.text(cell => {

					if(['s'].includes(this.axes.left.format))
						return d3.format('.4s')(cell.y);

					else
						return Format.number(cell.y)
				});
		}

		if(!options.resize) {

			bars = bars
				.attr('y', cell => this.y(0))
				.attr('height', () => 0)
				.transition()
				.delay((_, i) => (Page.animationDuration / this.x.domain().length) * i)
				.duration(Page.animationDuration)
				.ease('exp-out');

			if(values) {

				values = values
					.attr('y', cell => this.y(0))
					.attr('height', 0)
					.attr('opacity', 0)
					.transition()
					.delay((_, i) => (Page.animationDuration / this.x.domain().length) * i)
					.duration(Page.animationDuration)
					.ease('exp-out');
			}
		}

		bars
			.attr('y', cell => this.y(cell.y > 0 ? cell.y : 0))
			.attr('height', cell => Math.abs(this.y(cell.y) - this.y(0)));

		if(values) {

			values
				.attr('y', cell => this.y(cell.y > 0 ? cell.y : 0) - 3)
				.attr('height', cell => Math.abs(this.y(cell.y) - this.y(0)))
				.attr('opacity', 1);
		}
	}
});

Visualization.list.set('dualaxisbar', class DualAxisBar extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'dualaxisbar');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		await this.render(options);
	}

	constructor(visualization, source) {

		super(visualization, source);

		for(const axis of this.axes || []) {
			this.axes[axis.position] = axis;
			axis.column = axis.columns.length ? axis.columns[0].key : '';
		}
	}

	async draw() {

		const rows = await this.source.response();

		if(!rows || !rows.length)
			return this.source.error();

		if(!this.axes)
			return this.source.error('Axes not defined.');

		if(!this.axes.bottom)
			return this.source.error('Bottom axis not defined.');

		if(!this.axes.left)
			return this.source.error('Left axis not defined.');

		if(!this.axes.right)
			return this.source.error('Right axis not defined.');

		if(!this.axes.bottom.columns.length)
			return this.source.error('Bottom axis requires exactly one column.');

		if(!this.axes.left.columns.length)
			return this.source.error('Left axis requires atleast one column.');

		if(!this.axes.right.columns.length)
			return this.source.error('Right axis requires atleast one column.');

		if(this.axes.bottom.columns.length > 1)
			return this.source.error('Bottom axis cannot has more than one column.');

		for(const column of this.axes.bottom.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Bottom axis column <em>${column.key}</em> not found.)`);
		}

		for(const column of this.axes.left.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Left axis column <em>${column.key}</em> not found.`);
		}

		for(const column of this.axes.right.columns) {
			if(!this.source.columns.get(column.key))
				return this.source.error(`Right axis column <em>${column.key}</em> not found.`);
		}

		for(const bottom of this.axes.bottom.columns) {

			for(const left of this.axes.left.columns) {

				if(bottom.key == left.key)
					return this.source.error(`Column <em>${bottom.key}</em> cannot be on two axis.`);
			}

			for(const right of this.axes.right.columns) {

				if(bottom.key == right.key)
					return this.source.error(`Column <em>${bottom.key}</em> cannot be on two axis.`);
			}
		}

		if(this.axes.bottom.columns.every(c => this.source.columns.get(c.key).disabled))
			return this.source.error('Bottom axis requires atleast one column.');

		if(this.axes.left.columns.every(c => this.source.columns.get(c.key).disabled))
			return this.source.error('Left axis requires atleast one column.');

		if(this.axes.right.columns.every(c => this.source.columns.get(c.key).disabled))
			return this.source.error('Right axis requires atleast one column.');

		for(const [key, column] of this.source.columns) {

			if(this.axes.left.columns.some(c => c.key == key) || this.axes.right.columns.some(c => c.key == key) || this.axes.bottom.columns.some(c => c.key == key))
				continue;

			column.hidden = true;
			column.disabled = true;
			column.render();
		}

		this.rows = rows;

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

				this.plot({resize: true});
			}
		});
	}

	async render(options = {}) {

		await this.draw();
		await this.plot(options);
	}

	async plot(options = {})  {

		const container = d3.selectAll(`#visualization-${this.id}`);

		container.selectAll('*').remove();

		if(!this.rows || !this.rows.length)
			return;

		this.columns = {
			left: {},
			right: {},
		};

		for(const row of this.rows) {

			for(const [key, value] of row) {

				if(key == this.axes.bottom.column)
					continue;

				const column = this.source.columns.get(key);

				if(!column || column.disabled)
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

		if(!this.rows.length)
			return this.source.error();

		if(this.rows.length != (await this.source.response()).length) {

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
			resetZoom.on('click', async () => {
				this.rows = await this.source.response();
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
			biggestTick = this.bottom.domain().reduce((s, v) => s.length > v.length ? s : v, ''),
			tickNumber = Math.max(Math.floor(this.container.clientWidth / (biggestTick.length * 12)), 1),
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

		if(!options.resize) {

			bars = bars
				.attr('height', () => 0)
				.attr('y', () => this.height)
				.transition()
				.delay((_, i) => (Page.animationDuration / this.bottom.domain().length) * i)
				.duration(Page.animationDuration)
				.ease('exp-out');
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

		if(!options.resize) {

			path[0].forEach(path => {

				var length = path.getTotalLength();

				path.style.strokeDasharray = length + ' ' + length;
				path.style.strokeDashoffset = length;
				path.getBoundingClientRect();

				path.style.transition  = `stroke-dashoffset ${Page.animationDuration}ms ease-out`;
				path.style.strokeDashoffset = '0';
			});
		}

		// For each line appending the circle at each point
		for(const column of this.columns.right) {

			let dots = this.svg.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'clips')
				.style('fill', column.color)
				.attr('cx', d => this.bottom(d.x) + this.axes.left.width + (this.bottom.rangeBand() / 2))
				.attr('cy', d => this.right(d.y));

			if(!options.resize) {

				dots = dots
					.attr('r', 0)
					.transition()
					.delay((_, i) => (Page.animationDuration / this.bottom.domain().length) * i)
					.duration(0)
					.ease('exp-out');
			}

			dots.attr('r', 5);
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

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'stacked');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		await this.render(options);
	}

	async render(options = {}) {

		await this.draw();
		this.plot(options);
	}

	plot(options = {}) {

		super.plot(options);

		if(!this.rows || !this.rows.length)
			return;

		const that = this;

		const x1 = d3.scale.ordinal();
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

		if(['s'].includes(this.axes.bottom.format))
				xAxis.tickFormat(d3.format(this.axes.left.format));

		if(['s'].includes(this.axes.left.format))
				yAxis.tickFormat(d3.format(this.axes.left.format));

		let max = 0;

		for(const row of this.rows) {

			let total = 0;

			for(const [name, value] of row) {
				if(this.axes.left.columns.some(c => c.key == name))
					total += parseFloat(value) || 0;
			}

			max = Math.max(max, Math.ceil(total) || 0);
		}

		this.y.domain([0, max]);

		this.x.domain(this.rows.map(r => r.get(this.axes.bottom.column)));
		this.x.rangeBands([0, this.width], 0.1, 0);

		const
			biggestTick = this.x.domain().reduce((s, v) => s.length > v.length ? s : v, ''),
			tickNumber = Math.max(Math.floor(this.container.clientWidth / (biggestTick.length * 12)), 1),
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

			 let values;

		if(this.options.showValues) {

			values = this.svg
				.append('g')
				.selectAll('g')
				.data(this.columns)
				.enter()
				.append('g')
				.selectAll('text')
				.data(column => column)
				.enter()
				.append('text')
				.attr('width', x1.rangeBand())
				.attr('fill', '#666')
				.attr('x', cell => {

					let value = Format.number(cell.y);

					if(['s'].includes(this.axes.left.format))
						value = d3.format('.4s')(cell.y);

					return this.x(cell.x) + this.axes.left.width + (this.x.rangeBand() / 2) - (value.toString().length * 4);
				})
				.text(cell => {

					if(['s'].includes(this.axes.left.format))
						return d3.format('.4s')(cell.y);
					else
						return Format.number(cell.y)
				});
		}

		if(!options.resize) {

			bars = bars
				.attr('height', d => 0)
				.attr('y', d => this.height)
				.transition()
				.delay((_, i) => (Page.animationDuration / this.x.domain().length) * i)
				.duration(Page.animationDuration)
				.ease('exp-out');

			if(values) {

				values = values
					.attr('y', cell => this.y(0))
					.attr('height', 0)
					.attr('opacity', 0)
					.transition()
					.delay((_, i) => (Page.animationDuration / this.x.domain().length) * i)
					.duration(Page.animationDuration)
					.ease('exp-out');
			}
		}

		bars
			.attr('height', d => this.height - this.y(d.y))
			.attr('y', d => this.y(d.y + d.y0));

		if(values) {

			values
				.attr('y', cell => this.y(cell.y > 0 ? cell.y + cell.y0 : 0) - 3)
				.attr('height', cell => {return Math.abs(this.y(cell.y + cell.y0) - this.y(0))})
				.attr('opacity', 1);
		}
	}
});

Visualization.list.set('area', class Area extends LinearVisualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'area');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		await this.render(options);
	}

	async render(options = {}) {

		await this.draw();
		this.plot(options);
	}

	plot(options = {}) {

		super.plot(options);

		if(!this.rows || !this.rows.length)
			return;

		const
			container = d3.selectAll(`#visualization-${this.id}`),
			that = this;

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

		if(['s'].includes(this.axes.bottom.format))
				xAxis.tickFormat(d3.format(this.axes.left.format));

		if(['s'].includes(this.axes.left.format))
				yAxis.tickFormat(d3.format(this.axes.left.format));

		let
			max = 0,
			min = 0;

		for(const row of this.rows) {

			let total = 0;

			for(const [name, value] of row) {

				if(name == this.axes.bottom.column)
					continue;

				if(this.source.columns.get(name).disabled)
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
			biggestTick = this.x.domain().reduce((s, v) => s.length > v.length ? s : v, ''),
			tickNumber = Math.max(Math.floor(this.container.clientWidth / (biggestTick.length * 12)), 1),
			tickInterval = parseInt(this.x.domain().length / tickNumber),
			ticks = this.x.domain().filter((d, i) => !(i % tickInterval)),

			area = d3.svg.area()
				.x(d => this.x(d.x))
				.y0(d => this.y(d.y0))
				.y1(d => this.y(d.y0 + d.y));

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

		if(this.options.showValues) {

			this.svg
				.append('g')
				.selectAll('g')
				.data(this.columns)
				.enter()
				.append('g')
				.attr('transform', column => `translate(${x1(column.name)}, 0)`)
				.selectAll('text')
				.data(column => column)
				.enter()
				.append('text')
				.attr('width', x1.rangeBand())
				.attr('fill', '#666')
				.attr('x', cell => {

					let value = Format.number(cell.y);

					if(['s'].includes(this.axes.left.format))
						value = d3.format('.4s')(cell.y);

					return this.x(cell.x) + this.axes.left.width + (x1.rangeBand() / 2) - (value.toString().length * 4)
				})
				.text(cell => {

					if(['s'].includes(this.axes.left.format))
						return d3.format('.4s')(cell.y);

					else
						return Format.number(cell.y)
				})
				.attr('y', cell => this.y(cell.y > 0 ? cell.y : 0) - 5);
		}

		if(!options.resize) {

			areas = areas
				.attr('opacity', 0)
				.transition()
				.duration(Page.animationDuration)
				.ease("exp-out");
		}

		areas.attr('opacity', 0.8);

		// For each line appending the circle at each point
		for(const column of this.columns) {

			this.svg
				.selectAll('dot')
				.data(column)
				.enter()
				.append('circle')
				.attr('class', 'clips')
				.classed('drilldown', cell => that.source.columns.get(cell.key).drilldown)
				.attr('id', (d, i) => i)
				.attr('r', 0)
				.style('fill', column.color)
				.attr('cx', cell => this.x(cell.x) + this.axes.left.width)
				.attr('cy', cell => this.y(cell.y + cell.y0))
				.on('mouseover', function(cell) {

					if(!that.source.columns.get(cell.key).drilldown)
						return;

					d3.select(this)
						.attr('r', 6)
						.transition()
						.duration(Page.animationDuration)
						.attr('r', 12);

					d3.select(this).classed('hover', 1);
				})
				.on('mouseout', function(cell) {

					if(!that.source.columns.get(cell.key).drilldown)
						return;

					d3.select(this)
						.transition()
						.duration(Page.animationDuration)
						.attr('r', 6);

					d3.select(this).classed('hover', 0);
				})
				.on('click', (cell, row) => {
					that.source.columns.get(cell.key).initiateDrilldown(that.rows[row]);
				});
		}

		container
		.on('mousemove.area', function() {

			container.selectAll('svg > g > circle.clips').attr('r', 0);

			const
				mouse = d3.mouse(this),
				xpos = parseInt((mouse[0] - that.axes.left.width - 10) / (that.width / that.rows.length)),
				row = that.rows[xpos];

			if(!row || that.zoomRectangle)
				return;

			container.selectAll(`svg > g > circle[id='${xpos}'].clips`).attr('r', 6);
		})

		.on('mouseout.area', () => container.selectAll('svg > g > circle.clips').attr('r', 0));
	}
});

Visualization.list.set('funnel', class Funnel extends Visualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'funnel');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		await this.render(options);
	}

	async render(options = {}) {

		const
			series = [],
			rows = await this.source.response();

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
			options,
		});
	}

	draw(obj) {

		const options = obj.options;

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

		chart.plot = (options = {}) => {

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

			if(!options.resize) {
				rectangles = rectangles
					.attr("height", d => 0)
					.attr("y", d => 30)
					.transition()
					.duration(Page.animationDuration);
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
				.attr('fill', '#fff');

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

		chart.plot(options);

		window.addEventListener('resize', () => {
			width = this.container.clientWidth - margin.left - margin.right;
			chart.plot({resize: true});
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

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'pie');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		this.process();

		await this.render(options);
	}

	process() {

		const
			response = this.source.originalResponse,
			newResponse = {};

		if(!response || !response.data || !response.data.length)
			return;

		for(const row of this.source.originalResponse.data) {

			const value = parseFloat(row.value);

			if(!value)
				continue;

			newResponse[row.name] = value;
		}

		this.source.originalResponse.data = [newResponse];

		this.source.columns.clear();
		this.source.columns.update();
		this.source.columns.render();

		const visualizationToggle = this.source.container.querySelector('header .change-visualization');

		if(visualizationToggle)
			visualizationToggle.value = this.source.visualizations.indexOf(this);
	}

	async render(options = {}) {

		this.rows = await this.source.response();

		this.height = this.container.clientHeight - 20;
		this.width = this.container.clientWidth - 20;

		window.addEventListener('resize', () => {

			const
				height = this.container.clientHeight - 20,
				width = this.container.clientWidth - 20;

			if(this.width != width || this.height != height)
				this.render({resize: true});
		});

		const
			container = d3.selectAll(`#visualization-${this.id}`),
			radius = Math.min(this.width - 50, this.height - 50) / 2,
			that = this;

		container.selectAll('*').remove();

		if(!this.rows || !this.rows.length || !this.rows[0].size)
			return this.source.error();

		const
			[row] = this.rows,
			data = [],
			sum = Array.from(row.values()).reduce((sum, value) => sum + value, 0);

		for(const [name, value] of this.rows[0])
			data.push({name, value, percentage: Math.floor((value / sum) * 10000) / 100});

		const

			pie = d3.layout
				.pie()
				.value(row => row.percentage),

			arc = d3.svg.arc()
				.outerRadius(radius)
				.innerRadius(this.options && this.options.classicPie ? 0 : radius - 75),

			arcHover = d3.svg.arc()
				.outerRadius(radius + 10)
				.innerRadius(this.options && this.options.classicPie ? 0 : radius - 75),

			arcs = container
				.append('svg')
				.data([data.sort((a, b) => a.percentage - b.percentage)])
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
					<header>${that.source.columns.get(row.data.name).name}</header>
					<ul class="body">
						${row.data.value} (${row.data.percentage}%)
					</ul>
				`;

				Tooltip.show(that.container, mouse, content, row);

				d3.select(this).classed('hover', true);
			})

			.on('mouseenter', function(row) {

				d3
					.select(this)
					.transition()
					.duration(Page.animationDuration / 3)
					.attr('d', row => arcHover(row));
			})

			.on('mouseleave', function() {

				d3
					.select(this)
					.transition()
					.duration(Page.animationDuration / 3)
					.attr('d', row => arc(row));

				Tooltip.hide(that.container);

				d3.select(this).classed('hover', false);
			});

		if(!options.resize) {
			slice
				.transition()
				.duration(Page.animationDuration / data.length * 2)
				.delay((_, i) => i * Page.animationDuration / data.length)
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
		if(this.options && this.options.showValue == 'value') {

			arcs.append('text')
				.attr('transform', row => {
					row.innerRadius = radius - 50;
					row.outerRadius = radius;
					return `translate(${arc.centroid(row)})`;
				})
				.attr('text-anchor', 'middle')
				.text(row => Format.number(row.data.value));
		}

		else {

			arcs.append('text')
				.attr('transform', row => {
					row.innerRadius = radius - 50;
					row.outerRadius = radius;
					return `translate(${arc.centroid(row)})`;
				})
				.attr('text-anchor', 'middle')
				.text(row => Format.number(row.data.percentage) + '%');
		}
	}
});

Visualization.list.set('spatialmap', class SpatialMap extends Visualization {

	constructor(visualization, source) {

		super(visualization, source);

		if(!this.options) {

			this.options = {layers: []};
		}

		this.layers = new SpatialMapLayers(this.options.layers || [], this);
		this.themes = new SpatialMapThemes(this);
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'spatial-map');

		container.innerHTML = `
			<div class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		container.appendChild(this.layers.container);

		return container;
	}

	async load(options = {}) {

		super.render(options);

		await this.source.fetch(options);

		await this.render();
	}

	async render() {

		if(!this.options)
			return this.source.error('Map layers not defined');

		if(!this.options.layers || !this.options.layers.length)
			return this.source.error('Map layers not defined.');

		const zoom = this.options.zoom || 12;

		this.rows = await this.source.response();

		if(!this.map)
			this.map = new google.maps.Map(this.containerElement.querySelector('.container'), {
				zoom,
				center: {
					lat: this.options.centerLatitude || parseFloat(this.rows[0].get(this.options.layers[0].latitudeColumn)),
					lng: this.options.centerLongitude || parseFloat(this.rows[0].get(this.options.layers[0].longitudeColumn))
				}
			});

		this.map.set('styles', this.themes.get(this.options.theme).config || []);

		this.layers.render();

	}
})

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

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `
			<div class="loading">
				<i class="fa fa-spinner fa-spin"></i>
			</div>
		`;

		await this.source.fetch(options);

		await this.process();
		await this.render(options);
	}

	async process() {

		this.max = 0;

		const response = await this.source.response();

		response.pop();

		for(const row of response) {

			for(const column of row.get('data') || [])
				this.max = Math.max(this.max, column.count);
		}
	}

	async render() {

		const
			container = this.container.querySelector('.container'),
			table = document.createElement('table'),
			tbody = document.createElement('tbody'),
			type = this.source.filters.get('type').label.querySelector('input').value,
			response = await this.source.response();

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
			table.innerHTML = `<caption class="NA">${this.source.originalResponse.message || 'No data found!'}</caption>`;

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

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `
			<div class="loading">
				<i class="fa fa-spinner fa-spin"></i>
			</div>
		`;

		await this.source.fetch(options);

		await this.process();

		await this.render(options);
	}

	async process() {

		const [response] = await this.source.response();

		if(!this.options.column)
			return this.source.error('Value column not selected.');

		if(!response)
			return this.source.error('Invalid Response.');

		if(!response.has(this.options.column))
			return this.source.error(`<em>${this.options.column}</em> column not found.`);
	}

	async render(options = {}) {

		const [response] = await this.source.response();

		let value = response.getTypedValue(this.options.column);

		this.container.querySelector('.container').innerHTML = `<div class="value">${value}</div>`;
	}
});

Visualization.list.set('livenumber', class LiveNumber extends Visualization {

	get container() {

		if (this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('section');

		container.classList.add('visualization', 'livenumber');
		container.id = `visualization-${this.id}`;

		container.innerHTML = `
			<div class="graph"></div>
			<div class="container"></div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.source.columns.render();

		this.container.querySelector('.container').innerHTML = `
			<div class="loading">
				<i class="fa fa-spinner fa-spin"></i>
			</div>
		`;
		this.container.querySelector('.graph').textContent = null;

		if(this.subReports && this.subReports.length) {

			this.container.style.cursor = 'pointer';

			const actions = this.source.container.querySelector('header .actions');

			const card_info = this.source.container.querySelector('header .actions .card-info');

			if(!card_info) {

				actions.insertAdjacentHTML('beforeend', `
					<span class="card-info" title="${this.subReports.length + (this.subReports.length > 1 ? ' sub-cards' : ' sub-card')}">
						<i class="fas fa-ellipsis-h"></i>
					</span>
				`);
			}
		}

		this.container.on('click', async () => {

			if(!this.subReports || !this.subReports.length)
				return;

			if(this.subReportsLoaded) {

				this.subReportDialogBox.show();
				return;
			}

			this.subReportDialogBox.body.textContent = null;
			this.subReportDialogBox.show();

			let visualizations = [];

			for(const [index, report] of DataSource.list.entries()) {

				const selectedVisualizations = report.visualizations.filter(x => this.subReports.includes(x.visualization_id.toString()));

				visualizations = visualizations.concat(selectedVisualizations);
			}

			for(const visualization of visualizations) {

				const
					query = DataSource.list.get(visualization.query_id),
					report = new DataSource(query, this),
					[selectedVisualization] = report.visualizations.filter(x => x.visualization_id == visualization.visualization_id);

				report.visualizations.selected = selectedVisualization;

				report.visualizations.selected.load();
				this.subReportDialogBox.body.appendChild(report.container);
			}

			this.subReportsLoaded = true;
		});

		await this.source.fetch(options);

		await this.process();

		this.render(options);
	}

	async process() {

		if(!this.options)
			return this.source.error('Visualization configuration not set.');

		if(!this.options.timingColumn)
			return this.source.error('Timing column not selected.');

		if(!this.options.valueColumn)
			return this.source.error('Value column not selected.');

		this.dates = new Map;

		for(const row of await this.source.response()) {

			if(!row.has(this.options.timingColumn))
				return this.source.error(`Timing column '${this.options.timingColumn}' not found.`);

			if(!row.has(this.options.valueColumn))
				return this.source.error(`Value column '${this.options.valueColumn}' not found.`);

			if(!Date.parse(row.get(this.options.timingColumn)))
				return this.source.error(`Timing column value '${row.get(this.options.timingColumn)}' is not a valid date.`);

			this.dates.set(Date.parse(new Date(row.get(this.options.timingColumn)).toISOString().substring(0, 10)), row);
		}

		let today = new Date();

		today = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate(), today.getHours(), today.getMinutes(), today.getSeconds()));

		this.center = {
			value: 0,
			date: Date.parse(new Date(new Date(today - ((this.options.centerOffset || 0) * 24 * 60 * 60 * 1000))).toISOString().substring(0, 10)),
		};

		if(this.dates.has(this.center.date))
			this.center.value = this.dates.get(this.center.date).get(this.options.valueColumn);

		if(this.options.rightOffset != '') {

			this.right = {
				value: 0,
				date: Date.parse(new Date(this.center.date - ((this.options.rightOffset || 0) * 24 * 60 * 60 * 1000)).toISOString().substring(0, 10)),
			};

			if(this.dates.has(this.right.date)) {

				const value = this.dates.get(this.right.date).get(this.options.valueColumn);

				this.right.percentage = ((value - this.center.value) / value) * 100 * -1;
				this.right.value = value;
			}
		}

		if(this.options.leftOffset != '') {

			this.left = {
				value: 0,
				date: Date.parse(new Date(this.center.date - ((this.options.leftOffset || 0) * 24 * 60 * 60 * 1000)).toISOString().substring(0, 10)),
			};

			if(this.dates.has(this.left.date)) {

				const value = this.dates.get(this.left.date).get(this.options.valueColumn);

				this.left.percentage = ((value - this.center.value) / value) * 100 * -1;
				this.left.value = value;
			}
		}
	}

	render(options = {}) {

		if(!this.center)
			return this.source.error(`Center column not defined.`);

		const container = this.container.querySelector('.container');

		container.innerHTML = `<h5>${this.dates.get(this.center.date) ? this.dates.get(this.center.date).getTypedValue(this.options.valueColumn) : ''}</h5>`;
		this.center.container = this.container.querySelector('h5');

		if(this.left) {

			container.insertAdjacentHTML('beforeend', `
				<div class="left">
					<h6 class="percentage ${this.getColor(this.left.percentage)}">${this.left.percentage ? Format.number(this.left.percentage) + '%' : '-'}</h6>
					<span class="value">
						<span class="value-left">${this.dates.get(this.left.date) ? this.dates.get(this.left.date).getTypedValue(this.options.valueColumn) : ''}</span><br>
						<small title="${Format.date(this.left.date)}">
							${Format.number(this.options.leftOffset)} ${this.options.leftOffset == '1'? 'day' : 'days'} ago
						</small>
					</span>
				</div>
			`);

			this.left.container = this.container.querySelector('.value-left');
		}

		if(this.right) {

			container.insertAdjacentHTML('beforeend', `
				<div class="right">
					<h6 class="percentage ${this.getColor(this.right.percentage)}">${this.right.percentage ? Format.number(this.right.percentage) + '%' : '-'}</h6>
					<span class="value">
						<span class="value-right">${this.dates.get(this.right.date) ? this.dates.get(this.right.date).getTypedValue(this.options.valueColumn) : ''}</span><br>
						<small title="${Format.date(this.right.date)}">
							${Format.number(this.options.rightOffset)} day${this.options.rightOffset == '1'? '' : 's'} ago
						</small>
					</span>
				</div>
			`);

			this.right.container = this.container.querySelector('.value-right');
		}

		if(!options.resize)
			this.animate(options);

		if(this.options.showGraph)
			this.plotGraph(options);
	}

	animate(options) {

		const
			duration = Page.animationDuration * 2 / 1000,
			jumpsPerSecond = 20,
			jumps = Math.floor(duration * jumpsPerSecond),
			values = {
				center: 0,
				left: 0,
				right: 0,
			};

		const count = jump => {

			if(jump < jumps)
				setTimeout(() => window.requestAnimationFrame(() => count(jump + 1)), duration / jumps);

			for(const position of ['center', 'left', 'right']) {

				if(!this[position] || !this.dates.has(this[position].date))
					continue;

				values[position] = (this[position].value / jumps) * jump;

				if(this[position].value % 1 == 0)
					values[position] = Math.floor(values[position]);

				this[position].container.textContent = this.dates.get(this[position].date).getTypedValue(this.options.valueColumn, values[position]);
			}
		};

		count(1);
	}

	plotGraph(options) {

		const margin = {top: 30, right: 30, bottom: 30, left: 30};

		const container = d3.selectAll(`#visualization-${this.id} .graph`);

		container.selectAll('*').remove();

		if(!this.width) {
			this.width = this.container.clientWidth - margin.left - margin.right;
			this.height = this.container.clientHeight - margin.top - margin.bottom - 10;
		}

		const
			data = [],
			x = d3.scale.ordinal().rangePoints([0, this.width], 0.1, 0),
			y = d3.scale.linear().range([this.height, 0]),
			valueline = d3.svg.line()
				.x(d => x(d.date))
				.y(d => y(d.value));

		for(const row of this.dates.values()) {
			data.push({
				date: Format.date(row.get(this.options.timingColumn)),
				value: row.get(this.options.valueColumn),
			});
		}

		x.domain(data.map(d => d.date));
		y.domain([d3.min(data, d => d.value), d3.max(data, d => d.value)]);

		const svg = container
			.append('svg')
				.attr('width', this.width + margin.left + margin.right)
				.attr('height', this.height + margin.top + margin.bottom)
			.append('g')
				.attr('transform', `translate(${margin.left}, ${margin.top})`);

		svg.append('path')
			.attr('class', 'line')
			.attr('d', valueline(data))
			.attr('stroke', this.source.columns.get(this.options.valueColumn).color);

		if(!options.resize) {

			const
				path = svg.selectAll('path')[0][0],
				length = path.getTotalLength();

			path.style.strokeDasharray = length + ' ' + length;
			path.style.strokeDashoffset = length;
			path.getBoundingClientRect();

			path.style.transition  = `stroke-dashoffset ${Page.animationDuration}ms ease-in-out`;
			path.style.strokeDashoffset = '0';
		}

		window.addEventListener('resize', () => {

			const
				width = this.container.clientWidth - margin.left - margin.right,
				height = this.container.clientHeight - margin.top - margin.bottom - 10;

			if(this.width != width || this.height != height) {

				this.width = width;
				this.height = height;

				this.plotGraph({resize: true});
			}
		});

		if(!this.options.graphParallax)
			return;

		const graph = this.container.querySelector('.graph');

		this.container.on('mousemove', e => {

			const
				rect = this.container.getBoundingClientRect(),
				x = e.clientX - rect.left,
				y = e.clientY - rect.top,
				parallax = 30,
				valueX = ((x / this.container.clientWidth * parallax) - (parallax / 2)) * -1,
				valueY = ((y / this.container.clientHeight * parallax) - (parallax / 3)) * -1;

			graph.style.transform = `translate(${valueX}px, ${valueY}px)`;
		});

		this.container.on('mouseout', () => graph.removeAttribute('style'));
	}

	getColor(percentage) {

		if(!percentage)
			return '';

		let color = percentage > 0;

		if(this.invertValues)
			color = !color;

		return color ? 'green' : 'red';
	}

	get subReportDialogBox() {

		if(this.subReportsDialogBoxContainer)
			return this.subReportsDialogBoxContainer;

		const subReportDialog = this.subReportsDialogBoxContainer = new DialogBox();
		subReportDialog.container.classList.add('sub-reports-dialog');
		subReportDialog.heading = this.name;

		return subReportDialog;
	}
});

Visualization.list.set('json', class JSONVisualization extends Visualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'json');
		container.innerHTML = `
			<div id="visualization-${this.id}" class="container">
				<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>
			</div>
		`;

		return container;
	}

	async load(options = {}) {

		super.render(options);

		this.container.querySelector('.container').innerHTML = `<div class="loading"><i class="fa fa-spinner fa-spin"></i></div>`;

		await this.source.fetch(options);

		this.render(options);
	}

	render(options = {}) {

		this.editor = new CodeEditor({mode: 'json'});

		this.editor.editor.setTheme('ace/theme/clouds');

		this.editor.value = JSON.stringify(this.source.originalResponse.data, 0, 4);
		this.editor.editor.setReadOnly(true);

		this.container.textContent = null;
		this.container.appendChild(this.editor.container);
	}
});

Visualization.list.set('html', class JSONVisualization extends Visualization {

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('visualization', 'html');
		container.innerHTML = `<div id="visualization-${this.id}" class="container">${this.source.definition.query}</div>`;

		if(this.options && this.options.hideHeader)
			this.source.container.querySelector('header').classList.add('hidden');

		if(this.options && this.options.hideLegend)
			this.source.container.querySelector('.columns').classList.add('hidden');

		this.source.container.classList.add('flush');

		return container;
	}

	async load(options = {}) {

		super.render(options);
		this.render(options);
	}

	render(options = {}) {

		if(this.options && this.options.hideLegend)
			this.source.container.querySelector('.columns').classList.add('hidden');

		this.container.innerHTML = `<div id="visualization-${this.id}" class="container">${this.source.definition.query}</div>`;
	}
});

class SpatialMapLayers extends Set {

	constructor(layers, visualization) {

		super();

		this.visualization = visualization;
		this.visible =  new Set();

		for(const layer of layers) {

			this.add(new (SpatialMapLayer.types.get(layer.type))(layer, this));
		}
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('columns-toggle');

		container.innerHTML = `
			<div class="columns hidden"></div>
			<span class="arrow up" title="Plotted Layers"><i class="fas fa-angle-up"></i></span>
			<span class="arrow down hidden" title="Collapse"><i class="fas fa-angle-down"></i></span>
		`;

		container.on('click', () => {

			container.querySelector('.arrow.up').classList.toggle('hidden');
			container.querySelector('.arrow.down').classList.toggle('hidden');
			container.querySelector('.columns').classList.toggle('hidden');
		});

		for(const layer of this.values()) {

			this.visible.add(layer);
			container.querySelector('.columns').appendChild(layer.container);
		}

		return container;
	}

	render() {

		for(const layer of this.values()) {

			if(!layer.latitudeColumn)
				return this.visualization.source.error('Latitude Column not defined.');

			if(!this.visualization.source.columns.has(layer.latitudeColumn))
				return this.visualization.source.error(`Latitude Column '${layer.latitudeColumn}' not found.`);

			if(!layer.longitudeColumn)
				return this.visualization.source.error('Longitude Column not defined.');

			if(!this.visualization.source.columns.has(layer.longitudeColumn))
				return this.visualization.source.error(`Longitude Column '${layer.longitudeColumn}' not found.`);

			this.visible.has(layer) ? layer.plot() : layer.clear();
		}
	}
}

class SpatialMapLayer {

	constructor(layer, layers) {

		Object.assign(this, layer);

		this.layers = layers;
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('label');

		container.classList.add('column');

		container.innerHTML = `
				<span class="name">${this.layer_name} <span class="type">${this.type}</span></span>
				<input type="checkbox" name="visible_layers" checked>
			`;

		container.on('click', e => e.stopPropagation());

		const visibleCheck = container.querySelector('input[name=visible_layers]');

		visibleCheck.on('change', e => {

			container.classList.toggle('disabled');

			if(visibleCheck.checked)
				this.layers.visible.add(this);
			else
				this.layers.visible.delete(this);

			this.layers.render();
		});

		return container;

	}
}

SpatialMapLayer.types = new Map();

SpatialMapLayer.types.set('heatmap', class HeatMap extends SpatialMapLayer {

	constructor(layer, layers) {

		super(layer, layers);

		HeatMap.setup();

		this.heatmap = new google.maps.visualization.HeatmapLayer({
			radius: this.radius || 15,
			opacity: this.opacity || 0.6,
			gradient: HeatMap.gradient[this.gradient || 'standard']
		});
	}

	static setup() {

		HeatMap.gradient = {

			standard: [
				'rgba(102, 255, 0, 0)',
				'rgba(102, 255, 0, 1)',
				'rgba(147, 255, 0, 1)',
				'rgba(193, 255, 0, 1)',
				'rgba(238, 255, 0, 1)',
				'rgba(244, 227, 0, 1)',
				'rgba(249, 198, 0, 1)',
				'rgba(255, 170, 0, 1)',
				'rgba(255, 113, 0, 1)',
				'rgba(255, 57, 0, 1)',
				'rgba(255, 0, 0, 1)'
			],
			blue: [
				'rgba(0, 255, 255, 0)',
				'rgba(0, 255, 255, 1)',
				'rgba(0, 191, 255, 1)',
				'rgba(0, 127, 255, 1)',
				'rgba(0, 63, 255, 1)',
				'rgba(0, 0, 255, 1)',
				'rgba(0, 0, 223, 1)',
				'rgba(0, 0, 191, 1)',
				'rgba(0, 0, 159, 1)',
				'rgba(0, 0, 127, 1)',
				'rgba(63, 0, 91, 1)',
				'rgba(127, 0, 63, 1)',
				'rgba(191, 0, 31, 1)',
				'rgba(255, 0, 0, 1)'
			]
		}
	}

	plot() {

		if(this.heatmap.getMap())
			return;

		this.heatmap.setData(this.markers);
		this.heatmap.setMap(this.layers.visualization.map);
	}

	clear() {

		this.heatmap.setMap(null);
	}

	get markers() {

		const markers = [];

		for(const row of this.layers.visualization.rows) {

			if(this.weightColumn) {

				markers.push({
					location: new google.maps.LatLng(parseFloat(row.get(this.latitudeColumn)), parseFloat(row.get(this.longitudeColumn))),
					weight: parseFloat(row.get(this.weightColumn))
				});

				continue;
			}

			markers.push(
				new google.maps.LatLng(parseFloat(row.get(this.latitudeColumn)), parseFloat(row.get(this.longitudeColumn)))
			);
		}

		return markers
	}
});

SpatialMapLayer.types.set('clustermap', class ClusterMap extends SpatialMapLayer {

	plot() {

		if(this.clusterer)
			return;

		this.clusterer = new MarkerClusterer(this.layers.visualization.map, this.markers, { imagePath: 'https://raw.githubusercontent.com/googlemaps/js-marker-clusterer/gh-pages/images/m' });
	}

	clear() {

		if(this.clusterer) {

			this.clusterer.clearMarkers();
			this.clusterer = null;
		}
	}

	get markers() {

		const markers = [];

		for(const row of this.layers.visualization.rows) {
			markers.push(
				new google.maps.Marker({
					position: {
						lat: parseFloat(row.get(this.latitudeColumn)),
						lng: parseFloat(row.get(this.longitudeColumn)),
					},
				})
			);
		}

		return markers;
	}
});

SpatialMapLayer.types.set('scattermap', class ScatterMap extends SpatialMapLayer {

	plot() {

		const map = this.markers[0].getMap();

		for(const marker of this.markers) {

			if(!map)
				marker.setMap(this.layers.visualization.map);
		}
	}

	clear() {

		for(const marker of this.markers) {

			marker.setMap(null);
		}
	}

	get markers() {

		if(this.existingMarkers)
			return this.existingMarkers;

		const markers = this.existingMarkers = [];

		const
			markerColor = ['red', 'blue', 'green', 'orange', 'pink', 'yellow', 'purple'],
			urlPrefix = 'http://maps.google.com/mapfiles/ms/icons/';

		let uniqueFields = [];

		if(this.colorColumn) {

			uniqueFields = this.layers.visualization.rows.map(x => x.get(this.colorColumn));
			uniqueFields = Array.from(new Set(uniqueFields));
		}

		for(const row of this.layers.visualization.rows) {

			const infoContent = `
				<div>
					<table style="border: none;">
						<tr>
							<td>${this.colorColumn.slice(0, 1).toUpperCase() + this.colorColumn.slice(1)}</td>
							<td>${row.get(this.colorColumn) || ''}</td>
						</tr>
					</table>
					<hr>
					<span style="color: #888">Latitude: ${row.get(this.latitudeColumn)}, Longitude: ${row.get(this.longitudeColumn)}</span>
				</div>
			`;

			let infoPopUp;

			const markerObj = new google.maps.Marker({
				position: {
					lat: parseFloat(row.get(this.latitudeColumn)),
					lng: parseFloat(row.get(this.longitudeColumn)),
				},
				icon: urlPrefix + (markerColor[uniqueFields.indexOf(row.get(this.colorColumn)) % markerColor.length] || 'red') + '-dot.png',
			});

			markerObj.addListener('mouseover', () => {

				infoPopUp = new google.maps.InfoWindow({
					content: infoContent
				});

				infoPopUp.open(this.layers.visualization.map, markerObj);
			});

			markerObj.addListener('mouseout', () => {

				if(infoPopUp)
					infoPopUp.close();
			});

			markers.push(markerObj);
		}

		return markers;
	}
});

SpatialMapLayer.types.set('bubblemap', class BubbleMap extends SpatialMapLayer {

	plot() {

		const map = this.markers[0].getMap();

		for(const marker of this.markers) {

			if(!map)
				marker.setMap(this.layers.visualization.map);
		}
	}

	clear() {

		for(const marker of this.markers) {

			marker.setMap(null);
		}
	}

	get markers() {

		if(this.existingMarkers)
			return this.existingMarkers;

		const
			markers = this.existingMarkers = [],
			possibleRadiusValues = this.layers.visualization.rows.map(x => parseFloat(x.get(this.radiusColumn))),
			range = {
				source: {
					min: Math.min(...possibleRadiusValues),
					max: Math.max(...possibleRadiusValues),
				},
				target: {
					min: 100,
					max: 2000000,
				},
			};

		let uniqueFields = [];

		if(this.colorColumn) {

			uniqueFields = this.layers.visualization.rows.map(x => x.get(this.colorColumn));
			uniqueFields = Array.from(new Set(uniqueFields));
		}

		for(const row of this.layers.visualization.rows) {

			const markerRadius = parseFloat(row.get(this.radiusColumn));

			if(!markerRadius && markerRadius != 0)
				return this.layers.visualization.source.error('Radius column must contain numerical values');

			const color = DataSourceColumn.colors[uniqueFields.indexOf(row.get(this.colorColumn)) % DataSourceColumn.colors.length] || DataSourceColumn.colors[0];

			markers.push(new google.maps.Circle({
				radius: (((markerRadius - range.source.min) / range.source.max) * (range.target.max - range.target.min)) + range.target.min,
				center: {
					lat: parseFloat(row.get(this.latitudeColumn)),
					lng: parseFloat(row.get(this.longitudeColumn)),
				},
				strokeColor: color,
				strokeOpacity: 0.8,
				strokeWeight: 2,
				fillColor: color,
				fillOpacity: 0.35,
			}));
		}

		return markers;
	}
});

class SpatialMapThemes extends Map {

	constructor(visualization) {

		super();

		this.visualization = visualization;

		for(const theme of MetaData.spatialMapThemes.keys()) {

			this.set(theme, new SpatialMapTheme({name: theme, config: MetaData.spatialMapThemes.get(theme)}, this))
		}

		this.selected = this.visualization && this.visualization.options && this.visualization.options.theme ? this.visualization.options.theme : 'Standard';
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('theme-list');

		for(const theme of this.values()) {

			container.appendChild(theme.container);
		}

		return container;

	}
}

class SpatialMapTheme {

	constructor(theme, themes) {

		Object.assign(this, theme);

		this.themes = themes;
	}

	get container() {

		if(this.containerElement)
			return this.conatinerElement;

		const container = this.containerElement = document.createElement('span');

		container.classList.add('theme');

		container.innerHTML = `
			<div class="name">${this.name}</div>
		`;

		if(this.themes.selected == this.name)
			container.classList.add('selected');

		container.insertBefore(this.image, container.querySelector('.name'));

		container.on('click', () => {

			for(const element of container.parentNode.querySelectorAll('.theme')) {

				element.classList.remove('selected');
			}

			this.themes.selected = container.querySelector('.name').textContent;
			container.classList.add('selected');
		});

		return container;
	}

	get image() {

		const
			image = document.createElement('div');

		image.classList.add('theme-image', 'image-container');

		image.innerHTML = `
			<div class="road"></div>
			<div class="water"></div>
			<div class="park"></div>
		`;

		if(!this.config.length) {

			image.style.background = '#fff';
			image.querySelector('.road').style.background = '#ededed';
			image.querySelector('.water').style.background = '#aadaff';
			image.querySelector('.park').style.background = '#c0ecae';
		}
		else {

			image.style.background = this.config[0].stylers[0].color;

			const
				[roadColor] = this.config.filter(x => x.featureType == 'road'),
				[waterColor] = this.config.filter(x => x.featureType == 'water'),
				[parkColor] = this.config.filter(x => x.featureType == 'poi.park');

			image.querySelector('.road').style.background = roadColor.stylers[0].color;
			image.querySelector('.water').style.background = waterColor.stylers[0].color;
			image.querySelector('.park').style.background = parkColor.stylers[0].color;
		}

		return image;
	}
}

class ReportLogs extends Set {

	constructor(report, page, logtype) {

		super();

		this.report = report;
		this.page = page;
		this.logClass = logtype;
	}

	get container() {

		if(this.containerElement)
			return this.containerElement;

		const container = this.containerElement = document.createElement('div');

		container.classList.add('query-history');

		container.innerHTML = `
			<div class="list">
				<ul></ul>
				<div class="footer hidden">
					<span class="more">
						<i class="fa fa-angle-down"></i>
						<span>Show more logs</span>
						<i class="fa fa-angle-down"></i>
					</span>
					<span class="showing"></span>
				</div>
			</div>
			<div class="info hidden">
				<div class="toolbar"></div>
				<div class="block"></div>
			</div>
		`;

		container.querySelector('.list .footer').on('click', () => {

			if(container.querySelector('.list .footer .more').classList.contains('hidden')) {

				return;
			}

			this.load()
		});

		return container;
	}

	async load() {

		this.container.querySelector('.list ul').innerHTML = '<li class="loading"><span><i class="fa fa-spinner fa-spin"></i></span></li>';
		this.container.querySelector('.list .footer').classList.add('hidden');

		const
			parameters = {
				query_id: this.report.query_id,
				owner: 'query',
				offset: this.size,
			};

		this.currentResponse =  await API.call('reports/report/logs', parameters);

		for(const log of this.currentResponse) {

			this.add(new (this.logClass)(log, this));
		}

		this.render();
	}

	render() {

		const logList = this.container.querySelector('.list ul');

		if(!this.size) {

			logList.innerHTML = '<li class="NA block">No Report History Available</li>';
			return;
		}

		this.container.querySelector('.list .footer').classList.remove('hidden');

		logList.textContent = null;

		this.container.querySelector('.list .footer .more').classList.remove('hidden');
		this.container.querySelector('.info').classList.add('hidden');
		this.container.querySelector('.list').classList.remove('hidden');

		for(const log of this.values()) {

			logList.appendChild(log.container);
		}

		if(this.currentResponse.length < 10) {

			this.container.querySelector('.list .footer .more').classList.add('hidden');
		}

		this.container.querySelector('.list .showing').textContent = `Showing: ${this.size}`;
	}

	toggle(condition) {
		this.container.classList.toggle('hidden', !condition);
	}
}

class ReportLog {

	constructor(log, logs) {

		Object.assign(this, log);

		this.logs = logs;

		try {
			this.value = JSON.parse(this.value);
		}
		catch(e) {}

	}

	get container() {

		if(this.containerElement) {

			return this.containerElement;
		}

		const container = this.containerElement = document.createElement('li');

		container.classList.add('block');

		container.innerHTML = `
			<span class="clock"><i class="fa fa-history"></i></span>
			<span class="timing">${Format.dateTime(this.created_at)}</span>
			<a href="/user/profile/${this.updated_by}" target="_blank">${this.user_name}</a>
		`;

		container.on('click', () => this.load());
		container.querySelector('a').on('click', e => e.stopPropagation());

		return container;
	}

	load() {

		const logInfo = this.logs.container.querySelector('.info');

		logInfo.classList.remove('hidden');
		this.logs.container.querySelector('.list').classList.add('hidden');

		logInfo.querySelector('.toolbar').innerHTML =  `
			<button class="back"><i class="fa fa-arrow-left"></i> Back</button>
			<button class="restore"><i class="fa fa-window-restore"></i> Restore</button>
			<button class="run"><i class="fas fa-sync"></i> Run</button>
			<span class="log-title">
				<a href="/user/profile/${this.updated_by}" target="_blank">${this.user_name}</a> &#183; ${Format.dateTime(this.created_at)}
			</span>
		`;

		logInfo.querySelector('.toolbar button.back').on('click', () => {

			this.logs.container.querySelector('.list').classList.remove('hidden');
			logInfo.classList.add('hidden');
		});

		logInfo.querySelector('.toolbar .restore').on('click', () => {

			this.logs.report.connection.formJson = this.connection.json;

			new SnackBar({
				message: this.query_id + ' Query Restored',
				subtitle: 'The  restored query is not saved yet and will be lost on page reload.',
				icon: 'fa fa-plus',
			});
		});

		logInfo.querySelector('.toolbar .run').on('click', () => {

			this.logs.page.preview(this.connection.json);
		});
	}
}

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

DataSourceFilter.setup();
DataSourceColumnFilter.setup();
DataSourceColumnAccumulation.setup();
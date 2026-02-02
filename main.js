const { Plugin, Modal, PluginSettingTab, Setting, WorkspaceLeaf, Notice, setIcon, Workspace } = require('obsidian');

// Default settings
const DEFAULT_SETTINGS = {
	excludedFolders: ['attachments', 'Attachments'],
	showTags: true,
	showPath: true,
	sortOrder: 'recency', // 'recency' または 'opening-order'
	alwaysOpenInNewTab: false
};

// Tab palette modal
class TabPaletteModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
		this.selectedIndex = 0;
		this.tabs = [];
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('tab-palette-modal');

		// Get the list of tabs
		this.tabs = this.getFilteredTabs();

		// Title
		contentEl.createEl('h3', { text: 'タブ一覧' });

		// Tab list
		const tabList = contentEl.createDiv('tab-palette-list');
		this.renderTabs(tabList);

		// Keyboard event
		this.scope.register([], 'ArrowUp', () => {
			this.moveSelection(-1);
			return false;
		});

		this.scope.register([], 'ArrowDown', () => {
			this.moveSelection(1);
			return false;
		});

		this.scope.register([], 'Enter', () => {
			this.openSelectedTab();
			return false;
		});

		this.scope.register([], 'w', () => {
			this.closeSelectedTab();
			return false;
		});

		this.scope.register([], 'p', () => {
			this.pinSelectedTab();
			return false;
		});
	}

	// Get tabs after filtering out excluded folders
	getFilteredTabs() {
		const tabs = [];
		const workspace = this.app.workspace;

		workspace.iterateAllLeaves((leaf) => {
			const viewState = leaf.getViewState();
			if (viewState.type === 'markdown' || viewState.type === 'canvas') {
				const file = this.app.vault.getAbstractFileByPath(viewState.state.file);

				if (file) {
					// Check excluded folders
					let isExcluded = false;
					for (const folder of this.plugin.settings.excludedFolders) {
						if (file.path.startsWith(folder + '/') || file.path.startsWith(folder)) {
							isExcluded = true;
							break;
						}
					}

					if (!isExcluded) {
						tabs.push({
							leaf: leaf,
							file: file,
							name: file.basename,
							path: file.path,
							isPinned: leaf.pinned
						});
					}
				}
			}
		});

		// Order
		if (this.plugin.settings.sortOrder === 'recency') {
			// History order (most recently opened first)
			tabs.sort((a, b) => {
				const timeA = a.leaf.activeTime || 0;
				const timeB = b.leaf.activeTime || 0;
				return timeB - timeA;
			});
		}

		return tabs;
	}

	// Show the tab
	renderTabs(container) {
		container.empty();

		this.tabs.forEach((tab, index) => {
			const tabEl = container.createDiv('tab-palette-item');

			if (index === this.selectedIndex) {
				tabEl.addClass('is-selected');
			}

			if (tab.isPinned) {
				tabEl.addClass('is-pinned');
			}

			// Tab name
			const nameEl = tabEl.createDiv('tab-palette-name');

			// Pin icon
			if (tab.isPinned) {
				const pinIcon = nameEl.createSpan('tab-palette-pin-icon');
				setIcon(pinIcon, 'pin');
			}

			const nameText = nameEl.createSpan('tab-palette-name-text');
			nameText.setText(tab.name);

			// Show the tag and path on a single line
			const infoEl = tabEl.createDiv('tab-palette-info');

			if (this.plugin.settings.showPath) {
				const pathEl = infoEl.createSpan('tab-palette-path');
				pathEl.setText(tab.path);
			}

			if (this.plugin.settings.showTags) {
				// Get tags from the file's metadata
				const cache = this.app.metadataCache.getFileCache(tab.file);
				const allTags = [];

				// Inline-style tags (#tag within the body text)
				if (cache && cache.tags) {
					allTags.push(...cache.tags.map(t => t.tag));
				}

				// Frontmatter tags
				if (cache && cache.frontmatter && cache.frontmatter.tags) {
					const fmTags = cache.frontmatter.tags;
					if (Array.isArray(fmTags)) {
						allTags.push(...fmTags.map(t => '#' + t));
					} else if (typeof fmTags === 'string') {
						allTags.push('#' + fmTags);
					}
				}

				if (allTags.length > 0) {
					const tagsEl = infoEl.createSpan('tab-palette-tags');
					tagsEl.setText(allTags.join(' '));
				}
			}

			// Click event
			tabEl.addEventListener('click', () => {
				this.selectedIndex = index;
				this.openSelectedTab();
			});
		});
	}

	// Move the selection
	moveSelection(direction) {
		this.selectedIndex += direction;

		if (this.selectedIndex < 0) {
			this.selectedIndex = this.tabs.length - 1;
		} else if (this.selectedIndex >= this.tabs.length) {
			this.selectedIndex = 0;
		}

		// Re-render
		const container = this.contentEl.querySelector('.tab-palette-list');
		this.renderTabs(container);
	}

	// Open the currently selected tab
	openSelectedTab() {
		const tab = this.tabs[this.selectedIndex];
		if (tab) {
			this.app.workspace.setActiveLeaf(tab.leaf, { focus: true });
			this.close();
		}
	}

	// Close the currently selected tab
	closeSelectedTab() {
		const tab = this.tabs[this.selectedIndex];
		if (tab) {
			tab.leaf.detach();
			this.tabs.splice(this.selectedIndex, 1);

			if (this.selectedIndex >= this.tabs.length) {
				this.selectedIndex = Math.max(0, this.tabs.length - 1);
			}

			// Close once there are no tabs left
			if (this.tabs.length === 0) {
				this.close();
			} else {
				// Re-render
				const container = this.contentEl.querySelector('.tab-palette-list');
				this.renderTabs(container);
			}
		}
	}

	// Pin/unpin the currently selected tab
	pinSelectedTab() {
		const tab = this.tabs[this.selectedIndex];
		if (tab) {
			tab.leaf.setPinned(!tab.isPinned);
			tab.isPinned = !tab.isPinned;

			// Re-render
			const container = this.contentEl.querySelector('.tab-palette-list');
			this.renderTabs(container);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Settings tab
class TabPaletteSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Tab Palette 設定' });

		// Excluded folders
		new Setting(containerEl)
			.setName('除外フォルダ')
			.setDesc('タブ一覧に表示しないフォルダ名（カンマ区切り）')
			.addText(text => text
				.setPlaceholder('')
				.setValue(this.plugin.settings.excludedFolders.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.excludedFolders = value
						.split(',')
						.map(f => f.trim())
						.filter(f => f.length > 0);
					await this.plugin.saveSettings();
				}));

		// Show the tag
		new Setting(containerEl)
			.setName('タグを表示')
			.setDesc('タブ一覧にタグを表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showTags)
				.onChange(async (value) => {
					this.plugin.settings.showTags = value;
					await this.plugin.saveSettings();
				}));

		// Show the path
		new Setting(containerEl)
			.setName('パスを表示')
			.setDesc('タブ一覧にファイルパスを表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showPath)
				.onChange(async (value) => {
					this.plugin.settings.showPath = value;
					await this.plugin.saveSettings();
				}));

		// Order
		new Setting(containerEl)
			.setName('並び順')
			.setDesc('タブの並び順を選択')
			.addDropdown(dropdown => dropdown
				.addOption('recency', '履歴順（最近開いた順）')
				.addOption('opening-order', '開いた順')
				.setValue(this.plugin.settings.sortOrder)
				.onChange(async (value) => {
					this.plugin.settings.sortOrder = value;
					await this.plugin.saveSettings();
				}));

		// Always open in a new tab
		new Setting(containerEl)
			.setName('常に新しいタブで開く')
			.setDesc('ファイルを開く際、常に新しいタブで開く')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.alwaysOpenInNewTab)
				.onChange(async (value) => {
					this.plugin.settings.alwaysOpenInNewTab = value;
					await this.plugin.saveSettings();
				}));
	}
}

// Main plugin class
class TabPalettePlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		// Command to open the tab palette
		this.addCommand({
			id: 'open-tab-palette',
			name: 'タブパレットを開く',
			callback: () => {
				new TabPaletteModal(this.app, this).open();
			}
		});

		// Move to the previous tab
		this.addCommand({
			id: 'go-to-previous-tab',
			name: '前のタブに移動',
			callback: () => {
				this.goToPreviousTab();
			}
		});

		// Move to the next tab
		this.addCommand({
			id: 'go-to-next-tab',
			name: '次のタブに移動',
			callback: () => {
				this.goToNextTab();
			}
		});

		// Settings tab
		this.addSettingTab(new TabPaletteSettingTab(this.app, this));

		// Monkey patch for the "always open in new tab" feature
		this.registerMonkeyPatches();
	}

	// Override Workspace.getLeaf so it always opens in a new tab
	registerMonkeyPatches() {
		const plugin = this;

		// Save the original getLeaf method
		const originalGetLeaf = Workspace.prototype.getLeaf;

		// Override getLeaf
		Workspace.prototype.getLeaf = function(newLeaf) {
			// Always open in a new tab when "always open in new tab" is enabled
			if (plugin.settings.alwaysOpenInNewTab) {
				// Change to 'tab' when newLeaf is false or undefined
				if (!newLeaf) {
					newLeaf = 'tab';
				}
			}

			// Call the original method
			return originalGetLeaf.call(this, newLeaf);
		};

		// Revert this when the plugin is unloaded
		this.register(() => {
			Workspace.prototype.getLeaf = originalGetLeaf;
		});
	}

	// Move to the previous tab
	goToPreviousTab() {
		const workspace = this.app.workspace;
		const leaves = [];

		workspace.iterateAllLeaves((leaf) => {
			if (leaf.getViewState().type === 'markdown' || leaf.getViewState().type === 'canvas') {
				leaves.push(leaf);
			}
		});

		const activeLeaf = workspace.activeLeaf;
		const currentIndex = leaves.indexOf(activeLeaf);

		if (currentIndex > 0) {
			workspace.setActiveLeaf(leaves[currentIndex - 1], { focus: true });
		} else if (leaves.length > 0) {
			workspace.setActiveLeaf(leaves[leaves.length - 1], { focus: true });
		}
	}

	// Move to the next tab
	goToNextTab() {
		const workspace = this.app.workspace;
		const leaves = [];

		workspace.iterateAllLeaves((leaf) => {
			if (leaf.getViewState().type === 'markdown' || leaf.getViewState().type === 'canvas') {
				leaves.push(leaf);
			}
		});

		const activeLeaf = workspace.activeLeaf;
		const currentIndex = leaves.indexOf(activeLeaf);

		if (currentIndex < leaves.length - 1) {
			workspace.setActiveLeaf(leaves[currentIndex + 1], { focus: true });
		} else if (leaves.length > 0) {
			workspace.setActiveLeaf(leaves[0], { focus: true });
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

module.exports = TabPalettePlugin;

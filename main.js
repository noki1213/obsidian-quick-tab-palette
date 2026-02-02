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
		this.bookmarks = [];
		this.allItems = []; // tabs と bookmarks を統合したリスト
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('tab-palette-modal');

		// Get the list of tabs
		this.tabs = this.getFilteredTabs();
		
		// Get the bookmarks
		this.bookmarks = this.getBookmarks();
		
		// Build the combined list (tabs + bookmarks)
		this.allItems = [
			...this.tabs.map(tab => ({ type: 'tab', data: tab })),
			...this.bookmarks.map(bookmark => ({ type: 'bookmark', data: bookmark }))
		];

		// Title
		contentEl.createEl('h3', { text: 'Open Tabs' });

		// Tab list
		const tabList = contentEl.createDiv('tab-palette-list');
		this.renderTabs(tabList);

		// Bookmarks section
		if (this.bookmarks.length > 0) {
			// Divider
			contentEl.createEl('hr', { cls: 'tab-palette-separator' });

			// Bookmarks title
			contentEl.createEl('h3', { text: 'Bookmarks' });

			// Bookmark list
			const bookmarkList = contentEl.createDiv('tab-palette-bookmark-list');
			this.renderBookmarks(bookmarkList);
		}

		// Control whether the mouse cursor is shown or hidden
		const modalEl = this.modalEl;

		// Show the cursor on mouse movement
		modalEl.addEventListener('mousemove', () => {
			modalEl.removeClass('is-keyboard-mode');
		});

		// Hide the cursor during keyboard navigation
		const enableKeyboardMode = () => {
			modalEl.addClass('is-keyboard-mode');
		};

		// Keyboard event
		this.scope.register([], 'ArrowUp', () => {
			enableKeyboardMode();
			this.moveSelection(-1);
			return false;
		});

		this.scope.register([], 'ArrowDown', () => {
			enableKeyboardMode();
			this.moveSelection(1);
			return false;
		});

		this.scope.register([], 'Enter', () => {
			this.openSelectedTab();
			return false;
		});

		this.scope.register([], 'w', () => {
			enableKeyboardMode();
			this.closeSelectedTab();
			return false;
		});

		this.scope.register([], 'p', () => {
			enableKeyboardMode();
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
							isPinned: leaf.pinned,
							isBookmarked: this.isFileBookmarked(file.path)
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

			// Check the selection state within the combined list
			if (index === this.selectedIndex) {
				tabEl.addClass('is-selected');
			}

			if (tab.isPinned) {
				tabEl.addClass('is-pinned');
			}

			// Main single-row container
			const entryEl = tabEl.createDiv('tab-palette-entry');

			// Left side: pin icon + tab name + tags
			const leftEl = entryEl.createDiv('tab-palette-left');

			// Pin icon
			if (tab.isPinned) {
				const pinIcon = leftEl.createSpan('tab-palette-pin-icon');
				setIcon(pinIcon, 'pin');
			}

			// Bookmark icon
			if (tab.isBookmarked) {
				const starIcon = leftEl.createSpan('tab-palette-star-icon');
				setIcon(starIcon, 'star');
			}

			// Tab name
			const nameText = leftEl.createSpan('tab-palette-name-text');
			nameText.setText(tab.name);

			// Tag (to the right of the title)
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
					const tagsEl = leftEl.createSpan('tab-palette-tags');
					tagsEl.setText(allTags.join(' '));
				}
			}

			// Right side: path
			if (this.plugin.settings.showPath) {
				const rightEl = entryEl.createDiv('tab-palette-right');

				// Folder icon
				const folderIcon = rightEl.createSpan('tab-palette-folder-icon');
				setIcon(folderIcon, 'folder');

				// Path
				const pathEl = rightEl.createSpan('tab-palette-path');
				// Show only the directory part (excluding the file name)
				const pathParts = tab.path.split('/');
				pathParts.pop(); // 最後の要素（ファイル名）を除く
				const dirPath = pathParts.join('/') || '/';
				pathEl.setText(dirPath);
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

		// Loop over the length of the combined list
		const totalItems = this.allItems.length;
		if (this.selectedIndex < 0) {
			this.selectedIndex = totalItems - 1;
		} else if (this.selectedIndex >= totalItems) {
			this.selectedIndex = 0;
		}

		// Re-render both lists
		const tabContainer = this.contentEl.querySelector('.tab-palette-list');
		const bookmarkContainer = this.contentEl.querySelector('.tab-palette-bookmark-list');
		this.renderTabs(tabContainer);
		if (bookmarkContainer) {
			this.renderBookmarks(bookmarkContainer);
		}
		
		// Scroll the selected item into view
		this.scrollToSelected();
	}
	
	// Scroll to show the currently selected item
	scrollToSelected() {
		const selectedEl = this.contentEl.querySelector('.is-selected');
		if (selectedEl) {
			selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

	// Open the currently selected tab
	openSelectedTab() {
		const selectedItem = this.allItems[this.selectedIndex];
		if (!selectedItem) return;
		
		if (selectedItem.type === 'tab') {
			// For a tab: make that tab active
			this.app.workspace.setActiveLeaf(selectedItem.data.leaf, { focus: true });
		} else {
			// For a bookmark: open the file
			this.app.workspace.openLinkText(selectedItem.data.path, '', false);
		}
		this.close();
	}

	// Close the currently selected tab
	closeSelectedTab() {
		const selectedItem = this.allItems[this.selectedIndex];
		if (!selectedItem || selectedItem.type !== 'tab') return; // タブのみ閉じられる
		
		const tab = selectedItem.data;
		tab.leaf.detach();
		
		// Remove from the tabs array
		const tabIndex = this.tabs.indexOf(tab);
		if (tabIndex !== -1) {
			this.tabs.splice(tabIndex, 1);
		}
		
		// Rebuild allItems
		this.allItems = [
			...this.tabs.map(t => ({ type: 'tab', data: t })),
			...this.bookmarks.map(b => ({ type: 'bookmark', data: b }))
		];

		if (this.selectedIndex >= this.allItems.length) {
			this.selectedIndex = Math.max(0, this.allItems.length - 1);
		}

		// Close once there are no tabs left
		if (this.allItems.length === 0) {
			this.close();
		} else {
			// Re-render
			const tabContainer = this.contentEl.querySelector('.tab-palette-list');
			const bookmarkContainer = this.contentEl.querySelector('.tab-palette-bookmark-list');
			this.renderTabs(tabContainer);
			if (bookmarkContainer) {
				this.renderBookmarks(bookmarkContainer);
			}
		}
	}

	// Pin/unpin the currently selected tab
	pinSelectedTab() {
		const selectedItem = this.allItems[this.selectedIndex];
		if (!selectedItem || selectedItem.type !== 'tab') return; // タブのみピン可能
		
		const tab = selectedItem.data;
		tab.leaf.setPinned(!tab.isPinned);
		tab.isPinned = !tab.isPinned;

		// Re-render
		const tabContainer = this.contentEl.querySelector('.tab-palette-list');
		const bookmarkContainer = this.contentEl.querySelector('.tab-palette-bookmark-list');
		this.renderTabs(tabContainer);
		if (bookmarkContainer) {
			this.renderBookmarks(bookmarkContainer);
		}
	}

	// Check whether the file is bookmarked
	isFileBookmarked(filePath) {
		const bookmarkPlugin = this.app.internalPlugins?.plugins?.bookmarks;

		if (!bookmarkPlugin || !bookmarkPlugin.enabled) {
			return false;
		}

		const bookmarkItems = bookmarkPlugin.instance?.items || [];

		return bookmarkItems.some(item => {
			return item.type === 'file' && item.path === filePath;
		});
	}

	// Get the bookmarks
	getBookmarks() {
		const bookmarks = [];
		const bookmarkPlugin = this.app.internalPlugins?.plugins?.bookmarks;

		if (!bookmarkPlugin || !bookmarkPlugin.enabled) {
			return bookmarks;
		}

		const bookmarkItems = bookmarkPlugin.instance?.items || [];

		bookmarkItems.forEach(item => {
			// Get only file bookmarks
			if (item.type === 'file' && item.path) {
				const file = this.app.vault.getAbstractFileByPath(item.path);
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
						bookmarks.push({
							file: file,
							name: file.basename,
							path: file.path
						});
					}
				}
			}
		});

		return bookmarks;
	}

	// Show the bookmarks
	renderBookmarks(container) {
		container.empty();

		this.bookmarks.forEach((bookmark, index) => {
			const itemEl = container.createDiv('tab-palette-bookmark-item');
			
			// Check the selection state within the combined list (tabs.length + index)
			const globalIndex = this.tabs.length + index;
			if (globalIndex === this.selectedIndex) {
				itemEl.addClass('is-selected');
			}

			// Main single-row container
			const entryEl = itemEl.createDiv('tab-palette-entry');

			// Left side: star icon + file name
			const leftEl = entryEl.createDiv('tab-palette-left');

			// Star icon
			const starIcon = leftEl.createSpan('tab-palette-star-icon');
			setIcon(starIcon, 'star');

			// File name
			const nameText = leftEl.createSpan('tab-palette-name-text');
			nameText.setText(bookmark.name);

			// Tag (show tags on bookmarks too)
			if (this.plugin.settings.showTags) {
				const cache = this.app.metadataCache.getFileCache(bookmark.file);
				const allTags = [];

				if (cache && cache.tags) {
					allTags.push(...cache.tags.map(t => t.tag));
				}

				if (cache && cache.frontmatter && cache.frontmatter.tags) {
					const fmTags = cache.frontmatter.tags;
					if (Array.isArray(fmTags)) {
						allTags.push(...fmTags.map(t => '#' + t));
					} else if (typeof fmTags === 'string') {
						allTags.push('#' + fmTags);
					}
				}

				if (allTags.length > 0) {
					const tagsEl = leftEl.createSpan('tab-palette-tags');
					tagsEl.setText(allTags.join(' '));
				}
			}

			// Right side: path
			if (this.plugin.settings.showPath) {
				const rightEl = entryEl.createDiv('tab-palette-right');

				const folderIcon = rightEl.createSpan('tab-palette-folder-icon');
				setIcon(folderIcon, 'folder');

				const pathEl = rightEl.createSpan('tab-palette-path');
				const pathParts = bookmark.path.split('/');
				pathParts.pop();
				const dirPath = pathParts.join('/') || '/';
				pathEl.setText(dirPath);
			}

			// Click event
			itemEl.addEventListener('click', () => {
				this.selectedIndex = globalIndex;
				this.openSelectedTab();
			});
		});
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

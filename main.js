// Tab palette modal
class TabPaletteModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
		
		// State management
		this.activeSection = 'tabs'; // 'search', 'tabs', 'bookmarks'
		this.selectedTabIndex = 0;
		this.selectedBookmarkIndex = 0;
		this.selectedSearchIndex = 0;
		
		this.searchQuery = '';
		this.vaultFiles = []; // 全ファイルキャッシュ
		
		this.filteredTabs = [];
		this.filteredBookmarks = [];
		this.searchResults = [];
		
		this.tabs = [];
		this.bookmarks = [];
	}

	async onOpen() {
		const { contentEl, modalEl } = this;
		
		// Add the class that controls the overall modal size
		modalEl.addClass('mod-tab-palette');
		contentEl.addClass('tab-palette-modal');

		// Get all files (cached asynchronously)
		this.vaultFiles = this.app.vault.getFiles();

		// Initial data fetch
		this.tabs = this.getTabs();
		this.bookmarks = this.getBookmarksList();
		
		// Initial filtering (show all)
		this.performSearch('');

		// Create the search box
		const searchContainer = contentEl.createDiv('tab-palette-search-container');
		this.searchInput = searchContainer.createEl('input', {
			type: 'text',
			cls: 'tab-palette-search-input',
			placeholder: 'Search tabs, bookmarks, and vault...'
		});

		// Create the 3-column container
		const columnsEl = contentEl.createDiv('tab-palette-columns');

		// --- Left column: Search ---
		const searchColumn = columnsEl.createDiv('tab-palette-column');
		searchColumn.createEl('h3', { text: 'Vault Search' });
		const searchList = searchColumn.createDiv('tab-palette-search-list');
		
		// --- Center column: Open Tabs ---
		const tabsColumn = columnsEl.createDiv('tab-palette-column');
		tabsColumn.createEl('h3', { text: 'Open Tabs' });
		const tabList = tabsColumn.createDiv('tab-palette-list');
		
		// --- Right column: Bookmarks ---
		const bookmarksColumn = columnsEl.createDiv('tab-palette-column');
		bookmarksColumn.createEl('h3', { text: 'Bookmarks' });
		const bookmarkList = bookmarksColumn.createDiv('tab-palette-bookmark-list');

		// Initial render
		this.renderAll();

		// Set up event listeners
		this.searchInput.addEventListener('input', (e) => {
			const query = e.target.value;
			this.performSearch(query);
			this.renderAll();
		});

		this.searchInput.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				this.searchInput.blur(); // フォーカスを外してリスト操作モードへ
				this.modalEl.focus();
			} else if (e.key === 'Enter') {
				e.preventDefault();
				this.openSelectedTab();
			}
		});

		// Show the cursor on mouse movement
		modalEl.addEventListener('mousemove', () => {
			modalEl.removeClass('is-keyboard-mode');
		});

		// Hide the cursor during keyboard navigation
		const enableKeyboardMode = () => {
			modalEl.addClass('is-keyboard-mode');
		};

		// Register keyboard events (list navigation)
		this.scope.register([], 'ArrowUp', (e) => {
			enableKeyboardMode();
			this.moveSelection(-1);
			return false;
		});

		this.scope.register([], 'ArrowDown', (e) => {
			enableKeyboardMode();
			this.moveSelection(1);
			return false;
		});
		
		// Move between sections with the left/right keys
		this.scope.register([], 'ArrowLeft', (e) => {
			// When the search box has focus, cursor movement should take priority, but
			// To prioritize the requirement "navigate back and forth with the left/right arrow keys" while keeping it intuitive
			// When the input is focused, defer to its default behavior (cursor movement).
			if (document.activeElement === this.searchInput) return; 
			
			enableKeyboardMode();
			this.switchSection('left');
			return false;
		});

		this.scope.register([], 'ArrowRight', (e) => {
			if (document.activeElement === this.searchInput) return;

			enableKeyboardMode();
			this.switchSection('right');
			return false;
		});

		this.scope.register([], 'Enter', (e) => {
			this.openSelectedTab();
			return false;
		});
		
		// On character key input, restore focus to the search box if it isn't focused
		modalEl.addEventListener('keydown', (e) => {
			if (document.activeElement !== this.searchInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
				this.searchInput.focus();
			}
		});

		// Initial focus and scroll position
		this.searchInput.focus();
		this.activeSection = 'tabs'; // 初期選択はOpen Tabs
		this.renderAll();
		
		// Adjust scroll so the middle column is visible
		setTimeout(() => {
			tabsColumn.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
		}, 10);
	}
	
	// Run the search
	performSearch(query) {
		this.searchQuery = query.toLowerCase();
		
		// 1. Filter tabs
		this.filteredTabs = this.tabs.filter(tab => this.matchFile(tab.file, this.searchQuery));
		
		// 2. Filter bookmarks
		this.filteredBookmarks = this.bookmarks.filter(b => this.matchFile(b.file, this.searchQuery));
		
		// 3. Search results (search outside of tabs and bookmarks)
		// Build a set of paths to avoid duplicates
		const openPaths = new Set(this.tabs.map(t => t.path));
		// Whether to include bookmarks too is a matter of preference, but since AQS-like behavior means "search everything," it's fine to include them, though
		// Since the UI is split into columns, it might be more useful for the left column to hold "everything else."
		// But since the requirement is "search the whole vault," showing it even when duplicated is probably correct.
		// Should the logic here prioritize "files not yet shown, with duplicates removed"?
		// Actually, since this is meant to be "Search (whole vault)," show it even if it's a duplicate.
		
		if (!this.searchQuery) {
			this.searchResults = []; // クエリなしの時は検索結果なし（最近使ったファイルとか出す手もあるが）
		} else {
			this.searchResults = this.vaultFiles
				.filter(file => this.matchFile(file, this.searchQuery))
				.slice(0, 50); // パフォーマンスのため件数制限
		}
		
		// Reset and correct the index
		this.selectedTabIndex = Math.min(this.selectedTabIndex, Math.max(0, this.filteredTabs.length - 1));
		this.selectedBookmarkIndex = Math.min(this.selectedBookmarkIndex, Math.max(0, this.filteredBookmarks.length - 1));
		this.selectedSearchIndex = 0;
	}
	
	// File-matching logic
	matchFile(file, query) {
		if (!query) return true;
		if (!file) return false;
		
		// File name
		if (file.name.toLowerCase().includes(query)) return true;
		
		// Path
		if (file.path.toLowerCase().includes(query)) return true;
		
		// Tags (retrieved from the cache)
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache && cache.tags) {
			if (cache.tags.some(t => t.tag.toLowerCase().includes(query))) return true;
		}
		
		return false;
	}

	// Re-render everything
	renderAll() {
		const searchContainer = this.contentEl.querySelector('.tab-palette-search-list');
		const tabContainer = this.contentEl.querySelector('.tab-palette-list');
		const bookmarkContainer = this.contentEl.querySelector('.tab-palette-bookmark-list');
		
		if (searchContainer) this.renderSearchResults(searchContainer);
		if (tabContainer) this.renderTabs(tabContainer);
		if (bookmarkContainer) this.renderBookmarks(bookmarkContainer);
		
		this.scrollToSelected();
	}

	// Switch sections
	switchSection(direction) {
		const sections = ['search', 'tabs', 'bookmarks'];
		let currentIndex = sections.indexOf(this.activeSection);
		
		if (direction === 'right') {
			currentIndex++;
		} else if (direction === 'left') {
			currentIndex--;
		} else if (typeof direction === 'string' && sections.includes(direction)) {
			currentIndex = sections.indexOf(direction);
		}
		
		// Range limit
		if (currentIndex < 0) currentIndex = 0;
		if (currentIndex >= sections.length) currentIndex = sections.length - 1;
		
		const nextSection = sections[currentIndex];
		
		// Don't move into an empty section (optional)
		// if (nextSection === 'search' && this.searchResults.length === 0) ...
		
		if (this.activeSection !== nextSection) {
			this.activeSection = nextSection;
			this.renderAll();
			
			// Scroll so the column is visible
			const container = this.contentEl.querySelector('.tab-palette-columns');
			const targetColumn = container.children[currentIndex];
			if (targetColumn) {
				targetColumn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
			}
		}
	}

	// Get the list of tabs (raw data)
	getTabs() {
		const tabs = [];
		const workspace = this.app.workspace;

		workspace.iterateAllLeaves((leaf) => {
			const viewState = leaf.getViewState();
			if (viewState.type === 'markdown' || viewState.type === 'canvas') {
				const file = this.app.vault.getAbstractFileByPath(viewState.state.file);

				if (file) {
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
		
		if (this.plugin.settings.sortOrder === 'recency') {
			tabs.sort((a, b) => (b.leaf.activeTime || 0) - (a.leaf.activeTime || 0));
		}
		return tabs;
	}
	
	// Get tabs after filtering out excluded folders (unused here, handled in performSearch instead)
	getFilteredTabs() {
		return this.getTabs();
	}

	// Show the tab
	renderTabs(container) {
		container.empty();

		if (this.filteredTabs.length === 0) {
			container.createDiv({ text: 'No matching tabs', cls: 'tab-palette-empty-message' });
			return;
		}

		this.filteredTabs.forEach((tab, index) => {
			const tabEl = container.createDiv('tab-palette-item');

			if (this.activeSection === 'tabs' && index === this.selectedTabIndex) {
				tabEl.addClass('is-selected');
			}

			if (tab.isPinned) {
				tabEl.addClass('is-pinned');
			}

			this.renderEntryContent(tabEl, tab);

			tabEl.addEventListener('click', () => {
				this.activeSection = 'tabs';
				this.selectedTabIndex = index;
				this.openSelectedTab();
			});
		});
	}
	
	// Show the bookmarks
	renderBookmarks(container) {
		container.empty();

		if (this.filteredBookmarks.length === 0) {
			container.createDiv({ text: 'No matching bookmarks', cls: 'tab-palette-empty-message' });
			return;
		}

		this.filteredBookmarks.forEach((bookmark, index) => {
			const itemEl = container.createDiv('tab-palette-bookmark-item');
			
			if (this.activeSection === 'bookmarks' && index === this.selectedBookmarkIndex) {
				itemEl.addClass('is-selected');
			}

			this.renderEntryContent(itemEl, bookmark);

			itemEl.addEventListener('click', () => {
				this.activeSection = 'bookmarks';
				this.selectedBookmarkIndex = index;
				this.openSelectedTab();
			});
		});
	}

	// Show the search results
	renderSearchResults(container) {
		container.empty();
		
		if (this.searchResults.length === 0) {
			const msg = this.searchQuery ? 'No results found' : 'Type to search...';
			container.createDiv({ text: msg, cls: 'tab-palette-empty-message' });
			return;
		}
		
		this.searchResults.forEach((file, index) => {
			const itemEl = container.createDiv('tab-palette-search-item');
			
			if (this.activeSection === 'search' && index === this.selectedSearchIndex) {
				itemEl.addClass('is-selected');
			}
			
			// Shape the object for shared rendering
			const itemData = {
				file: file,
				name: file.basename,
				path: file.path,
				isPinned: false, // 検索結果にはピン情報は持たせない（必要なら取得可）
				isBookmarked: this.isFileBookmarked(file.path)
			};
			
			this.renderEntryContent(itemEl, itemData);
			
			itemEl.addEventListener('click', () => {
				this.activeSection = 'search';
				this.selectedSearchIndex = index;
				this.openSelectedTab();
			});
		});
	}

	// Render an item's contents (shared logic)
	renderEntryContent(container, item) {
		const entryEl = container.createDiv('tab-palette-entry');
		const leftEl = entryEl.createDiv('tab-palette-left');

		if (item.isPinned) {
			const pinIcon = leftEl.createSpan('tab-palette-pin-icon');
			setIcon(pinIcon, 'pin');
		}

		if (item.isBookmarked) {
			const starIcon = leftEl.createSpan('tab-palette-star-icon');
			setIcon(starIcon, 'star');
		} else {
			// Placeholder for icon alignment, or maybe a file icon?
			// Show nothing here
		}

		const nameText = leftEl.createSpan('tab-palette-name-text');
		nameText.setText(item.name);

		if (this.plugin.settings.showTags) {
			const cache = this.app.metadataCache.getFileCache(item.file);
			const allTags = [];
			if (cache && cache.tags) allTags.push(...cache.tags.map(t => t.tag));
			if (cache && cache.frontmatter && cache.frontmatter.tags) {
				const fmTags = cache.frontmatter.tags;
				if (Array.isArray(fmTags)) allTags.push(...fmTags.map(t => '#' + t));
				else if (typeof fmTags === 'string') allTags.push('#' + fmTags);
			}
			if (allTags.length > 0) {
				const tagsEl = leftEl.createSpan('tab-palette-tags');
				tagsEl.setText(allTags.join(' '));
			}
		}

		if (this.plugin.settings.showPath) {
			const rightEl = entryEl.createDiv('tab-palette-right');
			const folderIcon = rightEl.createSpan('tab-palette-folder-icon');
			setIcon(folderIcon, 'folder');
			
			const pathEl = rightEl.createSpan('tab-palette-path');
			const pathParts = item.path.split('/');
			pathParts.pop();
			const dirPath = pathParts.join('/') || '/';
			pathEl.setText(dirPath);
		}
	}

	// Move the selection
	moveSelection(direction) {
		if (this.activeSection === 'tabs') {
			this.selectedTabIndex = this.clampIndex(this.selectedTabIndex + direction, this.filteredTabs.length);
			this.renderTabs(this.contentEl.querySelector('.tab-palette-list'));
		} else if (this.activeSection === 'bookmarks') {
			this.selectedBookmarkIndex = this.clampIndex(this.selectedBookmarkIndex + direction, this.filteredBookmarks.length);
			this.renderBookmarks(this.contentEl.querySelector('.tab-palette-bookmark-list'));
		} else if (this.activeSection === 'search') {
			this.selectedSearchIndex = this.clampIndex(this.selectedSearchIndex + direction, this.searchResults.length);
			this.renderSearchResults(this.contentEl.querySelector('.tab-palette-search-list'));
		}
		
		this.scrollToSelected();
	}
	
	clampIndex(index, length) {
		if (length === 0) return 0;
		if (index < 0) return 0;
		if (index >= length) return length - 1;
		return index;
	}
	
	// Scroll to show the currently selected item
	scrollToSelected() {
		const selectedEl = this.contentEl.querySelector('.is-selected');
		if (selectedEl) {
			selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

	// Open the currently selected item
	openSelectedTab() {
		let fileToOpen = null;
		let leaf = null;

		if (this.activeSection === 'tabs') {
			const tab = this.filteredTabs[this.selectedTabIndex];
			if (tab) leaf = tab.leaf;
		} else if (this.activeSection === 'bookmarks') {
			const bookmark = this.filteredBookmarks[this.selectedBookmarkIndex];
			if (bookmark) fileToOpen = bookmark.file;
		} else if (this.activeSection === 'search') {
			const result = this.searchResults[this.selectedSearchIndex];
			if (result) fileToOpen = result;
		}

		if (leaf) {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
			this.close();
		} else if (fileToOpen) {
			// Open the file (move to an existing tab if one is open, otherwise follow settings like opening a new tab)
			// Check the tab palette's "always open in new tab" setting
			// But is it fine to just use openLinkText here, or should this be controlled via getLeaf instead
			// Use openLinkText to match the behavior of AQS and the standard switcher
			const leaf = this.app.workspace.getLeaf(false);
			leaf.openFile(fileToOpen);
			this.close();
		} else {
			// Do nothing, or close, if nothing is selected
			// this.close();
		}
	}

	// Close the currently selected tab (tab section only)
	closeSelectedTab() {
		if (this.activeSection !== 'tabs') return;
		
		const tab = this.filteredTabs[this.selectedTabIndex];
		if (!tab) return;
		
		tab.leaf.detach();
		
		// Update data
		this.tabs = this.getTabs();
		this.performSearch(this.searchQuery); // 再フィルタリング
		this.renderAll();
	}

	// Pin/unpin the currently selected tab
	pinSelectedTab() {
		if (this.activeSection !== 'tabs') return;
		
		const tab = this.filteredTabs[this.selectedTabIndex];
		if (!tab) return;
		
		tab.leaf.setPinned(!tab.isPinned);
		tab.isPinned = !tab.isPinned; // ローカル更新

		this.renderTabs(this.contentEl.querySelector('.tab-palette-list'));
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

	// Get the bookmarks (raw data)
	getBookmarksList() {
		const bookmarks = [];
		const bookmarkPlugin = this.app.internalPlugins?.plugins?.bookmarks;

		if (!bookmarkPlugin || !bookmarkPlugin.enabled) {
			return bookmarks;
		}

		const bookmarkItems = bookmarkPlugin.instance?.items || [];

		bookmarkItems.forEach(item => {
			if (item.type === 'file' && item.path) {
				const file = this.app.vault.getAbstractFileByPath(item.path);
				if (file) {
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
	
	// Kept for backward compatibility (unused)
	getBookmarks() { return this.getBookmarksList(); }

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

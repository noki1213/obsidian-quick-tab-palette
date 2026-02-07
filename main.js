const { Plugin, Modal, PluginSettingTab, Setting, WorkspaceLeaf, Notice, setIcon, Workspace, View, TFile, WorkspaceRoot, WorkspaceFloating, WorkspaceTabs, Platform, Keymap } = require('obsidian');

// --- Helper functions for the monkey patch ---
// A utility for safely patching Obsidian's internal handling
// Ported from the open-tab-settings plugin

// Function that patches multiple methods at once
// target: the object being patched (e.g. Workspace.prototype)
// patches: specified as { methodName: wrapperFunction }
// Return value: a function that reverts the patch
function applyPatches(target, patches) {
	const restoreFunctions = Object.keys(patches).map(methodName =>
		patchMethod(target, methodName, patches[methodName])
	);
	// Return all the revert functions together
	if (restoreFunctions.length === 1) return restoreFunctions[0];
	return function() {
		restoreFunctions.forEach(restore => restore());
	};
}

// Function that patches a single method
// target: the object being patched
// methodName: the name of the method being patched
// wrapperFactory: a function that takes the original method and returns a new one
// Return value: a function that reverts the patch
function patchMethod(target, methodName, wrapperFactory) {
	const original = target[methodName];
	const hadOwn = target.hasOwnProperty(methodName);
	// If there's no original function, build a fallback that calls up the prototype chain
	const fallback = hadOwn ? original : function() {
		return Object.getPrototypeOf(target)[methodName].apply(this, arguments);
	};

	let wrapper = wrapperFactory(fallback);

	// Preserve the prototype chain
	if (original) Object.setPrototypeOf(wrapper, original);
	Object.setPrototypeOf(proxy, wrapper);
	target[methodName] = proxy;

	return restore;

	// The function that actually gets called (a proxy)
	function proxy(...args) {
		// Run the restore logic if it has already been reverted
		if (wrapper === fallback && target[methodName] === proxy) restore();
		return wrapper.apply(this, args);
	}

	// Function that reverts the patch
	function restore() {
		if (target[methodName] === proxy) {
			if (hadOwn) {
				target[methodName] = fallback;
			} else {
				delete target[methodName];
			}
		}
		if (wrapper !== fallback) {
			wrapper = fallback;
			Object.setPrototypeOf(proxy, original || Function);
		}
	}
}

// Determine whether the tab is empty (a home tab or empty view)
function isEmptyLeaf(leaf) {
	return ['empty', 'home-tab-view'].includes(leaf.view.getViewType());
}

// Determine whether the tab is within the main workspace
function isInMainWorkspace(leaf) {
	const root = leaf.getRoot();
	return root instanceof WorkspaceRoot || root instanceof WorkspaceFloating;
}

// Default settings
const DEFAULT_SETTINGS = {
	excludedFolders: [],
	showTags: true,
	showPath: true,
	sortOrder: 'recency', // 'recency' または 'opening-order'
	alwaysOpenInNewTab: false,
	deduplicateTabs: true, // 重複タブ防止：同じファイルが開いていたらそのタブに切り替える
	newTabPlacement: 'after-active', // 新しいタブの位置：'after-active', 'after-pinned', 'beginning', 'end'
	newTabTabGroupPlacement: 'same', // タブグループの配置：'same', 'opposite', 'first', 'last'
	recentlyClosed: [], // 最近閉じたタブの履歴
	enableSearch: true,
	enableTabs: true,
	enableBookmarks: true,
	enableDailyNotes: true,
	dailyNoteFormat: '',
	dailyNoteFolder: ''
};

// Tab palette modal
class TabPaletteModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;

		// State management
		this.activeSection = 'tabs'; // 'search', 'tabs', 'bookmarks', 'dailyNotes'
		this.selectedTabIndex = 0;
		this.selectedBookmarkIndex = 0;
		this.selectedSearchIndex = 0;
		this.selectedDailyNoteIndex = 0;

		this.searchQuery = '';
		this.vaultFiles = []; // 全ファイルキャッシュ

		this.filteredTabs = [];
		this.filteredBookmarks = [];
		this.searchResults = [];
		this.dailyNotes = [];

		this.tabs = [];
		this.bookmarks = [];

		// Track whether IME composition is in progress
		this.isComposing = false;
	}

	getEnabledSections() {
		const sections = [];
		if (this.plugin.settings.enableSearch) sections.push('search');
		if (this.plugin.settings.enableTabs) sections.push('tabs');
		if (this.plugin.settings.enableBookmarks) sections.push('bookmarks');
		if (this.plugin.settings.enableDailyNotes) sections.push('dailyNotes');
		return sections;
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
		this.dailyNotes = this.getDailyNotes();
		
		// Initial state (show all)
		this.filteredTabs = this.tabs;
		this.filteredBookmarks = this.bookmarks;
		this.searchResults = []; // 初期は空にするか、全件出すか。ここでは空にする。

		// Create the 3-column container
		const columnsEl = contentEl.createDiv('tab-palette-columns');

		// --- Left column: Search ---
		if (this.plugin.settings.enableSearch) {
			const searchColumn = columnsEl.createDiv('tab-palette-column');
			searchColumn.createEl('h3', { text: 'Vault Search' });
			
			// Place the search box inside the left column
			const searchContainer = searchColumn.createDiv('tab-palette-search-container');
			this.searchInput = searchContainer.createEl('input', {
				type: 'text',
				cls: 'tab-palette-search-input',
				placeholder: 'Search vault...'
			});
			
			const searchList = searchColumn.createDiv('tab-palette-search-list');

			// Set up event listeners (only when search is enabled)
			this.searchInput.addEventListener('input', (e) => {
				const query = e.target.value;
				this.performSearch(query);
				this.renderAll();
			});

			this.searchInput.addEventListener('compositionstart', () => {
				this.isComposing = true;
			});

			this.searchInput.addEventListener('compositionend', () => {
				this.isComposing = false;
			});

			this.searchInput.addEventListener('keydown', (e) => {
				if (e.isComposing || this.isComposing) return;

				if (e.key === 'ArrowDown') {
					e.preventDefault();
					this.searchInput.blur();
					this.modalEl.focus();
				} else if (e.key === 'Enter') {
					e.preventDefault();
					this.openSelectedTab();
				}
			});
		}
		
		// --- Center column: Open Tabs ---
		let tabList = null;
		if (this.plugin.settings.enableTabs) {
			const tabsColumn = columnsEl.createDiv('tab-palette-column');
			tabsColumn.createEl('h3', { text: 'Tabs' });
			tabList = tabsColumn.createDiv('tab-palette-list');
		}
		
		// --- Right column: Bookmarks & Daily Notes ---
		// Create the column if either bookmarks or daily notes is enabled
		if (this.plugin.settings.enableBookmarks || this.plugin.settings.enableDailyNotes) {
			const bookmarksColumn = columnsEl.createDiv('tab-palette-column');
			
			if (this.plugin.settings.enableBookmarks) {
				bookmarksColumn.createEl('h3', { text: 'Bookmarks' });
				const bookmarkList = bookmarksColumn.createDiv('tab-palette-bookmark-list');
			}
			
			// Daily Notes section
			if (this.plugin.settings.enableDailyNotes) {
				// Add a divider if bookmarks is also enabled
				if (this.plugin.settings.enableBookmarks) {
					const divider = bookmarksColumn.createEl('hr', { cls: 'tab-palette-section-divider' });
				}
				const dailyNotesTitle = bookmarksColumn.createEl('h3', { text: 'Daily Notes' });
				dailyNotesTitle.addClass('daily-notes-title');
				const dailyNoteList = bookmarksColumn.createDiv('tab-palette-daily-note-list');
			}
		}

		// Add the keybinding help at the very bottom
		const helpFooter = contentEl.createDiv('tab-palette-help-footer');
		helpFooter.createSpan().setText('w: close  |  p: toggle pin  |  b: toggle bookmark');

		// Initial render
		this.renderAll();

		// Set up event listeners (excluding the search input)

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
			if (this.searchInput && document.activeElement === this.searchInput) return; 
			enableKeyboardMode();
			this.switchSection('left');
			return false;
		});

		this.scope.register([], 'ArrowRight', (e) => {
			// When the search box has focus
			if (this.searchInput && document.activeElement === this.searchInput) {
				// Check whether the cursor is at the end
				const isAtEnd = this.searchInput.selectionStart === this.searchInput.value.length;
				if (!isAtEnd) return; // 末尾でなければ通常のカーソル移動を許可
				
				// Blur focus to move to the next section if we're at the end
				this.searchInput.blur();
				this.modalEl.focus();
			}
			
			enableKeyboardMode();
			this.switchSection('right');
			return false;
		});

		this.scope.register([], 'Enter', (e) => {
			// Ignore while IME conversion is in progress
			if (e.isComposing || this.isComposing) return;
			this.openSelectedTab();
			return false;
		});

		// w key closes the tab
		this.scope.register([], 'w', (e) => {
			this.closeSelectedTab();
			return false;
		});

		// p key toggles pin/unpin on a tab
		this.scope.register([], 'p', (e) => {
			this.pinSelectedTab();
			return false;
		});

		// b key toggles bookmark/unbookmark
		this.scope.register([], 'b', (e) => {
			this.toggleBookmark();
			return false;
		});

		// Initial focus and scroll position
		// Use the activeSection set in the constructor

		this.renderAll();

		// Remove focus from the search box and focus the modal instead
		// Delay with setTimeout to make sure this runs reliably
		setTimeout(() => {
			if (this.searchInput) {
				this.searchInput.blur();
			}
			this.modalEl.focus();
			
			// Adjust scroll so the current active column is visible
			// Handle this generically since tabsColumn may not exist
			const container = this.contentEl.querySelector('.tab-palette-columns');
			if (container) {
				// This roughly centers things, but strictly speaking it should look up the column that corresponds to activeSection
				// No action needed here since this gets adjusted when switchSection is called or during renderAll
				// For now, just try a simple scroll
			}
		}, 10);
	}
	
	// Run the search
	performSearch(query) {
		this.searchQuery = query.toLowerCase();
		
		// 1. Filter tabs -> skip it (search results shouldn't be affected by this)
		this.filteredTabs = this.tabs;
		
		// 2. Filter bookmarks -> skip it
		this.filteredBookmarks = this.bookmarks;
		
		// 3. Search results (across the whole vault)
		if (!this.searchQuery) {
			this.searchResults = []; 
		} else {
			this.searchResults = this.vaultFiles
				.filter(file => {
					// Check excluded folders
					for (const folder of this.plugin.settings.excludedFolders) {
						if (file.path.startsWith(folder + '/') || file.path.startsWith(folder)) {
							return false;
						}
					}
					return this.matchFile(file, this.searchQuery);
				})
				.slice(0, 50);
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
		const dailyNoteContainer = this.contentEl.querySelector('.tab-palette-daily-note-list');
		
		if (searchContainer) this.renderSearchResults(searchContainer);
		if (tabContainer) this.renderTabs(tabContainer);
		if (bookmarkContainer) this.renderBookmarks(bookmarkContainer);
		if (dailyNoteContainer) this.renderDailyNotes(dailyNoteContainer);
		
		this.scrollToSelected();
	}

	// Switch sections
	switchSection(direction) {
		const sections = this.getEnabledSections();
		if (sections.length === 0) return;

		let currentIndex = sections.indexOf(this.activeSection);
		
		// Fall back to index 0 when nothing is found, e.g. if the current section is disabled
		if (currentIndex === -1) currentIndex = 0;
		
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
		
		if (this.activeSection !== nextSection) {
			this.activeSection = nextSection;

			// Focus the search box when moving to the search section
			if (nextSection === 'search' && this.searchInput) {
				this.searchInput.focus();
			}

			this.renderAll();

			// Scroll so the column is visible
			const container = this.contentEl.querySelector('.tab-palette-columns');
			// Need to compute the column's index
			// The physical column order is: search, tabs, bookmarks (including dailyNotes)
			// However, since dailyNotes is also listed separately in the sections array, the index mapping isn't a simple one-to-one
			
			// Find the target physical column
			let targetColumnIndex = -1;
			if (nextSection === 'search') targetColumnIndex = 0; // 常に左
			else if (nextSection === 'tabs') {
				// Index 1 if search is enabled, otherwise index 0
				targetColumnIndex = this.plugin.settings.enableSearch ? 1 : 0;
			}
			else if (nextSection === 'bookmarks' || nextSection === 'dailyNotes') {
				// Rightmost column
				let idx = 0;
				if (this.plugin.settings.enableSearch) idx++;
				if (this.plugin.settings.enableTabs) idx++;
				targetColumnIndex = idx;
			}
			
			if (container && targetColumnIndex >= 0 && targetColumnIndex < container.children.length) {
				const targetColumn = container.children[targetColumnIndex];
				if (targetColumn) {
					targetColumn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
				}
			}
		}
	}

	// Get the list of tabs (raw data)
	getTabs() {
		const tabs = [];
		const workspace = this.app.workspace;
		const openPaths = new Set();

		workspace.iterateAllLeaves((leaf) => {
			const viewState = leaf.getViewState();
			if (['markdown', 'canvas', 'image', 'pdf'].includes(viewState.type)) {
				// Check for this since the file property may be missing
				let path = viewState.state.file;
				// Prefer view.file when it's available (more reliable)
				if (leaf.view && leaf.view.file) {
					path = leaf.view.file.path;
				}

				const file = path ? this.app.vault.getAbstractFileByPath(path) : null;

				if (file) {
					openPaths.add(file.path);
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
							isBookmarked: this.isFileBookmarked(file.path),
							isRecentlyClosed: false
						});
					}
				}
			}
		});
		
		if (this.plugin.settings.sortOrder === 'recency') {
			tabs.sort((a, b) => (b.leaf.activeTime || 0) - (a.leaf.activeTime || 0));
		}

		// Add to recently closed tabs
		const recentlyClosed = this.plugin.settings.recentlyClosed || [];
		let firstClosed = true;

		recentlyClosed.forEach(closedTab => {
			// Exclude the currently open tab
			if (openPaths.has(closedTab.path)) return;

			// Check whether the file exists
			const file = this.app.vault.getAbstractFileByPath(closedTab.path);
			if (!file) return;

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
					leaf: null, // 閉じたタブなのでleafなし
					file: file,
					name: file.basename,
					path: file.path,
					isPinned: false,
					isBookmarked: this.isFileBookmarked(file.path),
					isRecentlyClosed: true,
					isHeader: firstClosed // 最初の項目にヘッダーフラグ
				});
				if (firstClosed) firstClosed = false;
			}
		});

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
			if (tab.isHeader) {
				container.createEl('hr', { cls: 'tab-palette-separator' });
				container.createDiv({ text: 'Recently Closed', cls: 'tab-palette-section-header' });
			}

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
			const container = this.contentEl.querySelector('.tab-palette-list');
			if (container) this.renderTabs(container);
		} else if (this.activeSection === 'bookmarks') {
			// Pressing ArrowDown at the bottom of bookmarks moves focus to dailyNotes (only when both are enabled)
			if (direction > 0 && 
				this.selectedBookmarkIndex === this.filteredBookmarks.length - 1 && 
				this.plugin.settings.enableDailyNotes && 
				this.dailyNotes.length > 0) {
				
				this.activeSection = 'dailyNotes';
				this.selectedDailyNoteIndex = 0;
				this.renderAll();
			} else {
				this.selectedBookmarkIndex = this.clampIndex(this.selectedBookmarkIndex + direction, this.filteredBookmarks.length);
				const container = this.contentEl.querySelector('.tab-palette-bookmark-list');
				if (container) this.renderBookmarks(container);
			}
		} else if (this.activeSection === 'search') {
			this.selectedSearchIndex = this.clampIndex(this.selectedSearchIndex + direction, this.searchResults.length);
			const container = this.contentEl.querySelector('.tab-palette-search-list');
			if (container) this.renderSearchResults(container);
		} else if (this.activeSection === 'dailyNotes') {
			// Pressing ArrowUp at the top of dailyNotes moves focus back to bookmarks (only when bookmarks is enabled)
			if (direction < 0 && 
				this.selectedDailyNoteIndex === 0 && 
				this.plugin.settings.enableBookmarks && 
				this.filteredBookmarks.length > 0) {
				
				this.activeSection = 'bookmarks';
				this.selectedBookmarkIndex = this.filteredBookmarks.length - 1;
				this.renderAll();
			} else {
				this.selectedDailyNoteIndex = this.clampIndex(this.selectedDailyNoteIndex + direction, this.dailyNotes.length);
				const container = this.contentEl.querySelector('.tab-palette-daily-note-list');
				if (container) this.renderDailyNotes(container);
			}
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
			if (tab) {
				leaf = tab.leaf;
				// For a closed tab there's no leaf, so set fileToOpen instead
				if (!leaf && tab.file) {
					fileToOpen = tab.file;
				}
			}
		} else if (this.activeSection === 'bookmarks') {
			const bookmark = this.filteredBookmarks[this.selectedBookmarkIndex];
			if (bookmark) fileToOpen = bookmark.file;
		} else if (this.activeSection === 'search') {
			const result = this.searchResults[this.selectedSearchIndex];
			if (result) fileToOpen = result;
		} else if (this.activeSection === 'dailyNotes') {
			const dailyNote = this.dailyNotes[this.selectedDailyNoteIndex];
			if (dailyNote) {
				if (!dailyNote.exists) {
					// Confirm creation if the file doesn't exist
					this.createDailyNote(dailyNote);
					return;
				}
				fileToOpen = dailyNote.file;
			}
		}

		if (leaf) {
			this.app.workspace.setActiveLeaf(leaf, { focus: true });
			this.close();
		} else if (fileToOpen) {
			// Open the file
			// Check the settings to decide whether to always open in a new tab
			const openInNewTab = this.plugin.settings.alwaysOpenInNewTab;
			
			const leaf = this.app.workspace.getLeaf(openInNewTab ? 'tab' : false);
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
		if (!tab || !tab.file) return;
		
		// Add to Recently Closed (unless the tab is already closed)
		if (tab.leaf) {
			const closedTabInfo = {
				path: tab.path,
				title: tab.name,
				basename: tab.name,
				extension: tab.file.extension
			};
			
			let updatedHistory = [...(this.plugin.settings.recentlyClosed || [])];
			// Remove duplicates from history and move the entry to the front
			updatedHistory = updatedHistory.filter(h => h.path !== closedTabInfo.path);
			updatedHistory.unshift(closedTabInfo);
			
			// Cap at 5 items
			if (updatedHistory.length > 5) {
				updatedHistory = updatedHistory.slice(0, 5);
			}
			
			this.plugin.settings.recentlyClosed = updatedHistory;
			this.plugin.saveSettings();

			tab.leaf.detach();
		}
		
		// Update data
		this.tabs = this.getTabs();
		this.performSearch(this.searchQuery); // 再フィルタリング
		this.renderAll();
	}

	// Pin/unpin the currently selected tab
	pinSelectedTab() {
		if (this.activeSection !== 'tabs') return;
		
		const tab = this.filteredTabs[this.selectedTabIndex];
		if (!tab || !tab.leaf) return;
		
		tab.leaf.setPinned(!tab.isPinned);
		tab.isPinned = !tab.isPinned; // ローカル更新

		this.renderTabs(this.contentEl.querySelector('.tab-palette-list'));
	}

	// Add/remove bookmark
	async toggleBookmark() {
		const bookmarkPlugin = this.app.internalPlugins?.plugins?.bookmarks;

		if (!bookmarkPlugin || !bookmarkPlugin.enabled) {
			new Notice('Bookmark plugin is not enabled');
			return;
		}

		let file = null;

		if (this.activeSection === 'tabs') {
			const tab = this.filteredTabs[this.selectedTabIndex];
			if (tab) file = tab.file;
		} else if (this.activeSection === 'bookmarks') {
			const bookmark = this.filteredBookmarks[this.selectedBookmarkIndex];
			if (bookmark) file = bookmark.file;
		} else if (this.activeSection === 'search') {
			const result = this.searchResults[this.selectedSearchIndex];
			if (result) file = result;
		} else if (this.activeSection === 'dailyNotes') {
			const dailyNote = this.dailyNotes[this.selectedDailyNoteIndex];
			if (dailyNote && dailyNote.exists) file = dailyNote.file;
		}

		if (!file) return;

		const bookmarkItems = bookmarkPlugin.instance?.items || [];
		const existingBookmark = bookmarkItems.find(item => item.type === 'file' && item.path === file.path);

		if (existingBookmark) {
			// Remove the bookmark
			bookmarkPlugin.instance.removeItem(existingBookmark);
			new Notice(`Removed bookmark: ${file.basename}`);
		} else {
			// Add the bookmark
			bookmarkPlugin.instance.addItem({
				type: 'file',
				path: file.path,
				title: file.basename
			});
			new Notice(`Added bookmark: ${file.basename}`);
		}

		// Re-render
		this.bookmarks = this.getBookmarksList();
		this.tabs = this.getTabs();
		this.dailyNotes = this.getDailyNotes();
		this.performSearch(this.searchQuery);
		this.renderAll();
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
	
	// Get the daily note
	getDailyNotes() {
		if (!this.plugin.settings.enableDailyNotes) {
			return [];
		}

		const dailyNotes = [];
		const format = this.plugin.settings.dailyNoteFormat || 'YYYY-MM-DD (ddd)';
		const folder = this.plugin.settings.dailyNoteFolder || '00_DailyNote';
		
		// require moment.js (bundled with Obsidian)
		const moment = window.moment;
		
		const today = moment();
		const dates = [
			{ label: 'Yesterday', date: today.clone().subtract(1, 'day') },
			{ label: 'Today', date: today.clone() },
			{ label: 'Tomorrow', date: today.clone().add(1, 'day') }
		];
		
		dates.forEach(({ label, date }) => {
			const filename = date.format(format) + '.md';
			const path = folder ? folder + '/' + filename : filename;
			
			const file = this.app.vault.getAbstractFileByPath(path);
			
			// Add to the array even if the file doesn't exist (tracked via an exists flag)
			dailyNotes.push({
				file: file,
				name: file ? file.basename : date.format(format),
				path: path,
				label: label,
				date: date.format('YYYY-MM-DD'),
				exists: !!file, // ファイルの存在フラグ
				momentDate: date // 作成時に使用
			});
		});
		
		return dailyNotes;
	}

	// Render the daily note
	renderDailyNotes(container) {
		container.empty();
		
		if (this.dailyNotes.length === 0) {
			container.createDiv({ text: 'No daily notes', cls: 'tab-palette-empty-message' });
			return;
		}
		
		this.dailyNotes.forEach((dailyNote, index) => {
			const itemEl = container.createDiv('tab-palette-bookmark-item');
			
			// Gray it out if it doesn't exist
			if (!dailyNote.exists) {
				itemEl.addClass('daily-note-not-exists');
			}
			
			if (this.activeSection === 'dailyNotes' && index === this.selectedDailyNoteIndex) {
				itemEl.addClass('is-selected');
			}
			
			// Display by file name, with the label on the right
			const entryEl = itemEl.createDiv('tab-palette-entry');
			const leftEl = entryEl.createDiv('tab-palette-left');
			
			// Show the file name
			const nameText = leftEl.createSpan('tab-palette-name-text');
			nameText.setText(dailyNote.name);
			
			// Show the label (Today/Yesterday/Tomorrow) on the right
			const rightEl = entryEl.createDiv('tab-palette-right');
			const labelEl = rightEl.createSpan('tab-palette-daily-note-label');
			labelEl.setText(dailyNote.label);
			
			itemEl.addEventListener('click', () => {
				this.activeSection = 'dailyNotes';
				this.selectedDailyNoteIndex = index;
				this.openSelectedTab();
			});
		});
	}
	
	// Create the daily note
	async createDailyNote(dailyNote) {
		const confirmed = confirm(`デイリーノート「${dailyNote.name}」を作成しますか？`);
		if (!confirmed) return;
		
		try {
			// Get the template path (from settings)
			const dailyNotesPlugin = this.app.internalPlugins?.plugins?.['daily-notes'];
			let templatePath = '';
			if (dailyNotesPlugin && dailyNotesPlugin.instance) {
				templatePath = dailyNotesPlugin.instance.options?.template || '';
			}
			
			// Create the file
			let content = '';
			if (templatePath) {
				const templateFile = this.app.vault.getAbstractFileByPath(templatePath + '.md');
				if (templateFile) {
					content = await this.app.vault.read(templateFile);
				}
			}
			
			// Create the folder if it doesn't exist
			const folder = this.plugin.settings.dailyNoteFolder || '00_DailyNote';
			if (folder) {
				const folderExists = this.app.vault.getAbstractFileByPath(folder);
				if (!folderExists) {
					await this.app.vault.createFolder(folder);
				}
			}
			
			// Create the file
			const newFile = await this.app.vault.create(dailyNote.path, content);
			
			// Open the file
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(newFile);
			
			this.close();
		} catch (error) {
			new Notice(`デイリーノートの作成に失敗しました: ${error.message}`);
		}
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

		// --- Section display settings ---
		containerEl.createEl('h3', { text: 'セクションの表示設定' });

		new Setting(containerEl)
			.setName('検索 (Search)')
			.setDesc('Vault内の検索機能を表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableSearch)
				.onChange(async (value) => {
					this.plugin.settings.enableSearch = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('開いているタブ (Tabs)')
			.setDesc('現在開いているタブの一覧を表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableTabs)
				.onChange(async (value) => {
					this.plugin.settings.enableTabs = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('ブックマーク (Bookmarks)')
			.setDesc('Obsidianのブックマークを表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableBookmarks)
				.onChange(async (value) => {
					this.plugin.settings.enableBookmarks = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('デイリーノート (Daily Notes)')
			.setDesc('直近のデイリーノート（昨日・今日・明日）を表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDailyNotes)
				.onChange(async (value) => {
					this.plugin.settings.enableDailyNotes = value;
					// Ideally this would re-render after saving settings to toggle the detail settings below, but
					// here we simply save it and leave it at that
					await this.plugin.saveSettings();
					this.display(); // Re-renderして詳細設定の表示状態を更新
				}));

		// --- Display options ---
		containerEl.createEl('h3', { text: '表示オプション' });

		new Setting(containerEl)
			.setName('ファイルパスを表示')
			.setDesc('リスト各項目にフォルダパスを表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showPath)
				.onChange(async (value) => {
					this.plugin.settings.showPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('タグを表示')
			.setDesc('リスト各項目にタグを表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showTags)
				.onChange(async (value) => {
					this.plugin.settings.showTags = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('除外フォルダ')
			.setDesc('一覧に表示しないフォルダ（カンマ区切り）')
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

		// --- Behavior settings ---
		containerEl.createEl('h3', { text: '動作設定' });

		new Setting(containerEl)
			.setName('タブの並び順')
			.setDesc('タブ一覧の並び順を選択')
			.addDropdown(dropdown => dropdown
				.addOption('recency', '履歴順（最近開いた順）')
				.addOption('opening-order', '開いた順（タブバーの並び）')
				.setValue(this.plugin.settings.sortOrder)
				.onChange(async (value) => {
					this.plugin.settings.sortOrder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('常に新しいタブで開く')
			.setDesc('リンクのクリックやパレットからの選択時、常に新しいタブで開く（Obsidian全体に適用）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.alwaysOpenInNewTab)
				.onChange(async (value) => {
					this.plugin.settings.alwaysOpenInNewTab = value;
					await this.plugin.saveSettings();
					this.display(); // 関連設定の表示を更新
				}));

		// Only show the detail settings when alwaysOpenInNewTab is enabled
		if (this.plugin.settings.alwaysOpenInNewTab) {
			new Setting(containerEl)
				.setName('重複タブを防止')
				.setDesc('同じファイルがすでに開いている場合、新しいタブを作らずにそのタブに切り替える')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.deduplicateTabs)
					.onChange(async (value) => {
						this.plugin.settings.deduplicateTabs = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('新しいタブの位置')
				.setDesc('新しいタブをどこに配置するか')
				.addDropdown(dropdown => dropdown
					.addOption('after-active', '現在のタブの後ろ')
					.addOption('after-pinned', 'ピン留めタブの後ろ')
					.addOption('beginning', '先頭')
					.addOption('end', '末尾')
					.setValue(this.plugin.settings.newTabPlacement)
					.onChange(async (value) => {
						this.plugin.settings.newTabPlacement = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('タブグループの配置')
				.setDesc('画面を分割している場合、新しいタブをどのグループに開くか')
				.addDropdown(dropdown => dropdown
					.addOption('same', '同じタブグループ')
					.addOption('opposite', '反対側のタブグループ')
					.addOption('first', '最初のタブグループ')
					.addOption('last', '最後のタブグループ')
					.setValue(this.plugin.settings.newTabTabGroupPlacement)
					.onChange(async (value) => {
						this.plugin.settings.newTabTabGroupPlacement = value;
						await this.plugin.saveSettings();
					}));
		}

		// --- Daily note detail settings ---
		// Show only when Daily Notes is enabled
		if (this.plugin.settings.enableDailyNotes) {
			containerEl.createEl('h3', { text: 'デイリーノート設定' });

			new Setting(containerEl)
				.setName('日付フォーマット')
				.setDesc('moment.js形式（例: YYYY-MM-DD (ddd)）')
				.addText(text => text
					.setPlaceholder('')
					.setValue(this.plugin.settings.dailyNoteFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteFormat = value || 'YYYY-MM-DD (ddd)';
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('保存先フォルダ')
				.setDesc('デイリーノートが保存されるフォルダパス')
				.addText(text => text
					.setPlaceholder('')
					.setValue(this.plugin.settings.dailyNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteFolder = value || '00_DailyNote';
						await this.plugin.saveSettings();
					}));
		}
	}
}

// Main plugin class
class TabPalettePlugin extends Plugin {
	async onload() {
		await this.loadSettings();
		
		// Register the monkey patch (opens a new tab on link clicks too)
		this.registerMonkeyPatches();

		// Initialize state for closed-tab detection
		this.lastOpenTabs = this.getOpenTabsInfo();
		
		// Watch for layout changes to detect closed tabs
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.detectClosedTabs();
			})
		);

		// Command to open the tab palette
		this.addCommand({
			id: 'open-tab-palette',
			name: 'Quick Tab Paletteを開く',
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
	}

	// Get info about the currently open tabs
	getOpenTabsInfo() {
		const leaves = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			const viewState = leaf.getViewState();
			// Target file types
			if (['markdown', 'canvas', 'image', 'pdf'].includes(viewState.type)) {
				const file = leaf.view.file;
				if (file) {
					leaves.push({
						path: file.path,
						title: leaf.getDisplayText(),
						basename: file.basename,
						extension: file.extension
					});
				}
			}
		});
		return leaves;
	}

	// Detect closed tabs and save them to history
	detectClosedTabs() {
		const currentTabs = this.getOpenTabsInfo();
		
		// Find items that existed before but are gone now
		const closedTabs = this.lastOpenTabs.filter(lastTab => 
			!currentTabs.some(currTab => currTab.path === lastTab.path)
		);

		if (closedTabs.length > 0) {
			let updatedHistory = [...(this.settings.recentlyClosed || [])];
			
			// Add the newly closed tab to the front
			closedTabs.forEach(tab => {
				// Remove duplicates from history and move the entry to the front
				updatedHistory = updatedHistory.filter(h => h.path !== tab.path);
				updatedHistory.unshift(tab);
			});

			// Cap at 5 items
			if (updatedHistory.length > 5) {
				updatedHistory = updatedHistory.slice(0, 5);
			}

			this.settings.recentlyClosed = updatedHistory;
			this.saveSettings();
		}

		this.lastOpenTabs = currentTabs;
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

	// --- Monkey patch: override Obsidian's internal handling so clicking a link also opens it in a new tab ---
	registerMonkeyPatches() {
		const plugin = this;

		// Patch Workspace.prototype.getLeaf and getUnpinnedLeaf
		this.register(applyPatches(Workspace.prototype, {
			// getLeaf: controls the behavior when opening a tab
			getLeaf(original) {
				return function(navigation, ...rest) {
					if (!plugin.settings.alwaysOpenInNewTab) {
						return original.call(this, navigation, ...rest);
					}

					const activeView = this.getActiveViewOfType(View);
					const activeLeaf = activeView ? activeView.leaf : undefined;

					let leaf;
					if (navigation === 'tab') {
						// Create a new tab when a tab is explicitly specified
						leaf = plugin.createNewLeaf(undefined, plugin.settings);
					} else if (!navigation) {
						// Regular click -> open in a new tab if alwaysOpenInNewTab is enabled
						leaf = plugin.createNewLeaf(true, plugin.settings);
					} else {
						// Defer other cases (e.g. split) to the original logic
						leaf = original.call(this, navigation, ...rest);
					}

					// Record info about the original tab that was opened (used for duplicate-tab prevention)
					leaf.openTabSettings = {
						openMode: navigation,
						openedFrom: activeLeaf ? activeLeaf.id : undefined
					};
					return leaf;
				};
			},

			// getUnpinnedLeaf: controls the behavior of fetching an unpinned tab
			getUnpinnedLeaf(original) {
				return function(navigation) {
					if (plugin.settings.alwaysOpenInNewTab) {
						return this.getLeaf('tab');
					}
					return plugin.getUnpinnedLeaf(navigation);
				};
			}
		}));

		// Patch WorkspaceLeaf.prototype.openFile (duplicate-tab prevention)
		this.register(applyPatches(WorkspaceLeaf.prototype, {
			openFile(original) {
				return async function(file, openState, ...rest) {
					// Reset openTabSettings unless it's an empty tab
					if (!isEmptyLeaf(this)) {
						delete this.openTabSettings;
					}

					const tabSettings = this.openTabSettings || {};
					const openMode = tabSettings.openMode;
					const openedFrom = tabSettings.openedFrom;
					const settings = plugin.settings;

					// Look for a tab that has this same file open
					let matchingLeaves = plugin.findMatchingLeaves(file);

					// If this tab itself already matches, just open it as-is
					const selfMatches = matchingLeaves.includes(this);

					// Defer to the original logic for cases opened outside the main workspace or other special cases
					const isOutsideMainWorkspace = !isInMainWorkspace(this) ||
						(isEmptyLeaf(this) && ![false, 'tab'].includes(openMode !== undefined ? openMode : 'unknown'));

					let redirectLeaf;

					if (settings.deduplicateTabs && !isOutsideMainWorkspace && matchingLeaves.length > 0 && !selfMatches) {
						// Duplicate-tab prevention: move focus to the tab that already has this file open
						// First, look within the same tab group as the original tab that was opened
						redirectLeaf = matchingLeaves.find(l => l.id === openedFrom);
						if (!redirectLeaf) {
							redirectLeaf = matchingLeaves.find(l => l.parent === this.parent);
						}
						if (!redirectLeaf) {
							redirectLeaf = matchingLeaves[0];
						}
					}

					let result;
					if (redirectLeaf) {
						// Open the file in the redirect-target tab
						const activeViewLeaf = plugin.app.workspace.getActiveViewOfType(View);
						const currentActive = activeViewLeaf ? activeViewLeaf.leaf : undefined;
						result = await original.call(redirectLeaf, file, {
							...openState,
							active: !!(openState && openState.active) || currentActive === this
						}, ...rest);
					} else {
						// Open the file in this tab as usual
						result = await original.call(this, file, openState, ...rest);
					}

					// Close it if an empty tab is left over
					if (isEmptyLeaf(this) && this.parent && this.parent.children.length > 1) {
						this.detach();
					}

					delete this.openTabSettings;
					return result;
				};
			}
		}));

		// Patch Keymap.isModEvent (changes behavior for Ctrl/Cmd+click)
		this.register(applyPatches(Keymap, {
			isModEvent(original) {
				return function(...args) {
					let result = original.call(this, ...args);
					if (result === 'tab' && plugin.settings.alwaysOpenInNewTab) {
						// When alwaysOpenInNewTab is enabled, Ctrl/Cmd+click opens in the same tab instead
						result = false;
					}
					return result;
				};
			}
		}));
	}

	// Look for a tab that already has this same file open
	findMatchingLeaves(file) {
		const matches = [];
		this.app.workspace.iterateAllLeaves(leaf => {
			const state = leaf.getViewState();
			const statePath = state && state.state ? state.state.file : undefined;
			const isSameFile = statePath === file.path;

			const viewType = leaf.view.getViewType();
			const expectedType = this.app.viewRegistry.getTypeByExtension(file.extension);
			const isMatchingType = expectedType === viewType;

			if (isInMainWorkspace(leaf) && isSameFile && isMatchingType) {
				matches.push(leaf);
			}
		});
		return matches;
	}

	// Get all tab groups
	getAllTabGroups(root) {
		const groups = new Set();
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.getRoot() === root) {
				groups.add(leaf.parent);
			}
		});
		return [...groups];
	}

	// Create a new tab
	createNewLeaf(focus, settings = {}) {
		const workspace = this.app.workspace;
		focus = focus !== undefined ? focus : this.app.vault.getConfig('focusNewTab');

		const opts = { ...this.settings, ...settings };
		const recentLeaf = workspace.getMostRecentLeaf();
		if (!recentLeaf) throw new Error('No tab group found.');

		let targetParent = recentLeaf.parent;
		const currentIndex = targetParent.children.indexOf(recentLeaf);

		// Reuse an empty tab if one exists
		if (isEmptyLeaf(recentLeaf)) return recentLeaf;

		let targetGroup;
		// Decide the destination group according to the tab-group placement setting
		if (opts.newTabTabGroupPlacement !== 'same' && !Platform.isPhone) {
			const allGroups = this.getAllTabGroups(recentLeaf.getRoot());
			const otherGroups = allGroups.filter(g => g !== targetParent);
			const lastOther = otherGroups.at(-1);

			if (opts.newTabTabGroupPlacement === 'opposite' && lastOther) {
				targetGroup = lastOther;
			} else if (opts.newTabTabGroupPlacement === 'first' && allGroups.at(0)) {
				targetGroup = allGroups[0];
			} else if (opts.newTabTabGroupPlacement === 'last' && allGroups.at(-1)) {
				targetGroup = allGroups.at(-1);
			}
		}

		if (!targetGroup) targetGroup = targetParent;

		// Decide the insertion position
		let insertIndex;
		if (targetGroup === targetParent) {
			if (opts.newTabPlacement === 'after-pinned') {
				const lastPinnedIndex = targetGroup.children.findLastIndex(child => child.pinned);
				insertIndex = lastPinnedIndex >= 0 ? lastPinnedIndex + 1 : currentIndex + 1;
			} else if (opts.newTabPlacement === 'beginning') {
				insertIndex = 0;
			} else if (opts.newTabPlacement === 'end') {
				insertIndex = targetParent.children.length;
			} else {
				// 'after-active' is the default
				insertIndex = currentIndex + 1;
			}
		} else {
			insertIndex = opts.newTabPlacement === 'beginning' ? 0 : targetGroup.children.length;
		}

		// Reuse an empty tab at the insertion point if one exists
		let newLeaf;
		const leafAtIndex = targetGroup.children[Math.min(insertIndex, targetGroup.children.length - 1)];
		if (leafAtIndex && isEmptyLeaf(leafAtIndex)) {
			newLeaf = leafAtIndex;
		} else {
			newLeaf = new WorkspaceLeaf(this.app);
			const prevTab = targetGroup.currentTab;
			targetGroup.insertChild(insertIndex, newLeaf);
			// Preserve the original tab's selection state
			if (insertIndex <= prevTab && (targetGroup !== targetParent || !focus)) {
				targetGroup.selectTabIndex(prevTab + 1);
			}
		}

		if (focus) workspace.setActiveLeaf(newLeaf);
		return newLeaf;
	}

	// Get an unpinned tab
	getUnpinnedLeaf(focus = true, settings = {}) {
		const workspace = this.app.workspace;
		const opts = { ...this.settings, ...settings };
		const activeLeaf = workspace.activeLeaf;

		// Use the current tab as-is if it's navigable
		if (activeLeaf && activeLeaf.canNavigate()) return activeLeaf;

		// Look for a navigable tab
		const container = (activeLeaf && activeLeaf.getContainer()) || workspace.rootSplit;
		let bestLeaf = null;

		workspace.iterateLeaves(container, leaf => {
			if (leaf.canNavigate()) {
				const parent = leaf.parent;
				if (parent) {
					const isCurrentTab = parent.children[parent.currentTab] === leaf;
					const isStacked = parent instanceof WorkspaceTabs && parent.isStacked;
					if (isCurrentTab || isStacked) {
						if (!bestLeaf || bestLeaf.activeTime < leaf.activeTime) {
							bestLeaf = leaf;
						}
					}
				}
			}
		});

		if (bestLeaf) {
			if (focus) workspace.setActiveLeaf(bestLeaf);
		} else {
			bestLeaf = this.createNewLeaf(focus, opts);
		}
		return bestLeaf;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

module.exports = TabPalettePlugin;

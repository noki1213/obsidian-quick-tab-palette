const { Plugin, Modal, PluginSettingTab, Setting, WorkspaceLeaf, Notice, setIcon, Workspace } = require('obsidian');

// デフォルト設定
const DEFAULT_SETTINGS = {
	excludedFolders: ['attachments', 'Attachments'],
	showTags: true,
	showPath: true,
	sortOrder: 'recency', // 'recency' または 'opening-order'
	alwaysOpenInNewTab: false
};

// タブパレットモーダル
class TabPaletteModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
		
		// 状態管理
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
		
		// モーダル全体のサイズ制御用クラスを追加
		modalEl.addClass('mod-tab-palette');
		contentEl.addClass('tab-palette-modal');

		// 全ファイルを取得（非同期でキャッシュ）
		this.vaultFiles = this.app.vault.getFiles();

		// データ初期取得
		this.tabs = this.getTabs();
		this.bookmarks = this.getBookmarksList();
		
		// 初期フィルタリング（全件表示）
		this.performSearch('');

		// 検索ボックスの作成
		const searchContainer = contentEl.createDiv('tab-palette-search-container');
		this.searchInput = searchContainer.createEl('input', {
			type: 'text',
			cls: 'tab-palette-search-input',
			placeholder: 'Search tabs, bookmarks, and vault...'
		});

		// 3カラムコンテナを作成
		const columnsEl = contentEl.createDiv('tab-palette-columns');

		// --- 左カラム：Search ---
		const searchColumn = columnsEl.createDiv('tab-palette-column');
		searchColumn.createEl('h3', { text: 'Vault Search' });
		const searchList = searchColumn.createDiv('tab-palette-search-list');
		
		// --- 中央カラム：Open Tabs ---
		const tabsColumn = columnsEl.createDiv('tab-palette-column');
		tabsColumn.createEl('h3', { text: 'Open Tabs' });
		const tabList = tabsColumn.createDiv('tab-palette-list');
		
		// --- 右カラム：Bookmarks ---
		const bookmarksColumn = columnsEl.createDiv('tab-palette-column');
		bookmarksColumn.createEl('h3', { text: 'Bookmarks' });
		const bookmarkList = bookmarksColumn.createDiv('tab-palette-bookmark-list');

		// 初回描画
		this.renderAll();

		// イベントリスナー設定
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

		// マウス移動でカーソルを表示
		modalEl.addEventListener('mousemove', () => {
			modalEl.removeClass('is-keyboard-mode');
		});

		// キーボード操作でカーソルを非表示
		const enableKeyboardMode = () => {
			modalEl.addClass('is-keyboard-mode');
		};

		// キーボードイベント登録 (リスト操作)
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
		
		// 左右キーでセクション移動
		this.scope.register([], 'ArrowLeft', (e) => {
			// 検索ボックスにフォーカスがある場合は、カーソル移動を優先したいが、
			// ユーザー要望「矢印キー左右で行き来できる」を優先し、かつ直感的にするために
			// inputにフォーカスがある時はinputのデフォルト動作（文字移動）に任せる。
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
		
		// 文字キー入力時、検索ボックスにフォーカスがない場合はフォーカスを戻す
		modalEl.addEventListener('keydown', (e) => {
			if (document.activeElement !== this.searchInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
				this.searchInput.focus();
			}
		});

		// 初期フォーカスとスクロール位置
		this.searchInput.focus();
		this.activeSection = 'tabs'; // 初期選択はOpen Tabs
		this.renderAll();
		
		// 真ん中のカラムが見えるようにスクロール調整
		setTimeout(() => {
			tabsColumn.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
		}, 10);
	}
	
	// 検索実行
	performSearch(query) {
		this.searchQuery = query.toLowerCase();
		
		// 1. Tabs フィルタリング
		this.filteredTabs = this.tabs.filter(tab => this.matchFile(tab.file, this.searchQuery));
		
		// 2. Bookmarks フィルタリング
		this.filteredBookmarks = this.bookmarks.filter(b => this.matchFile(b.file, this.searchQuery));
		
		// 3. Search Results (TabsとBookmarks以外から検索)
		// 重複を避けるため、パスのセットを作成
		const openPaths = new Set(this.tabs.map(t => t.path));
		// ブックマークも含めるかは好みだが、AQSっぽくするなら「全検索」なので含めてもいいが、
		// UIが分かれているので、左カラムは「それ以外」の方が便利かもしれない。
		// しかし「Vault全体検索」という要望なので、重複しても出すのが正解か。
		// ここでは「重複を排除して、まだ出ていないファイル」を優先して出すロジックにする？
		// いや、ユーザーは「Search (Vault全体)」と言っているので、重複してても出す。
		
		if (!this.searchQuery) {
			this.searchResults = []; // クエリなしの時は検索結果なし（最近使ったファイルとか出す手もあるが）
		} else {
			this.searchResults = this.vaultFiles
				.filter(file => this.matchFile(file, this.searchQuery))
				.slice(0, 50); // パフォーマンスのため件数制限
		}
		
		// インデックスのリセットと補正
		this.selectedTabIndex = Math.min(this.selectedTabIndex, Math.max(0, this.filteredTabs.length - 1));
		this.selectedBookmarkIndex = Math.min(this.selectedBookmarkIndex, Math.max(0, this.filteredBookmarks.length - 1));
		this.selectedSearchIndex = 0;
	}
	
	// ファイルマッチングロジック
	matchFile(file, query) {
		if (!query) return true;
		if (!file) return false;
		
		// ファイル名
		if (file.name.toLowerCase().includes(query)) return true;
		
		// パス
		if (file.path.toLowerCase().includes(query)) return true;
		
		// タグ (キャッシュから取得)
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache && cache.tags) {
			if (cache.tags.some(t => t.tag.toLowerCase().includes(query))) return true;
		}
		
		return false;
	}

	// 全体を再描画
	renderAll() {
		const searchContainer = this.contentEl.querySelector('.tab-palette-search-list');
		const tabContainer = this.contentEl.querySelector('.tab-palette-list');
		const bookmarkContainer = this.contentEl.querySelector('.tab-palette-bookmark-list');
		
		if (searchContainer) this.renderSearchResults(searchContainer);
		if (tabContainer) this.renderTabs(tabContainer);
		if (bookmarkContainer) this.renderBookmarks(bookmarkContainer);
		
		this.scrollToSelected();
	}

	// セクション切り替え
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
		
		// 範囲制限
		if (currentIndex < 0) currentIndex = 0;
		if (currentIndex >= sections.length) currentIndex = sections.length - 1;
		
		const nextSection = sections[currentIndex];
		
		// 空のセクションには移動しない（オプション）
		// if (nextSection === 'search' && this.searchResults.length === 0) ...
		
		if (this.activeSection !== nextSection) {
			this.activeSection = nextSection;
			this.renderAll();
			
			// カラムが見えるようにスクロール
			const container = this.contentEl.querySelector('.tab-palette-columns');
			const targetColumn = container.children[currentIndex];
			if (targetColumn) {
				targetColumn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
			}
		}
	}

	// タブ一覧を取得 (生データ)
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
	
	// 除外フォルダをフィルタリングしてタブを取得 (今回は使用しない、performSearchで実施)
	getFilteredTabs() {
		return this.getTabs();
	}

	// タブを表示
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
	
	// ブックマークを表示
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

	// 検索結果を表示
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
			
			// 共通レンダリング用にオブジェクト整形
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

	// アイテムの中身を描画（共通化）
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
			// アイコンの位置合わせのためのダミー、あるいはファイルアイコン？
			// ここでは何も表示しない
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

	// 選択を移動
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
	
	// 選択中の項目をスクロールして表示
	scrollToSelected() {
		const selectedEl = this.contentEl.querySelector('.is-selected');
		if (selectedEl) {
			selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

	// 選択中の項目を開く
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
			// ファイルを開く（既存のタブがあればそこに移動、なければ新規タブなど設定に従う）
			// タブパレットの「常に新規タブで開く」設定を確認
			// しかしここはシンプルに openLinkText でいいか、あるいは getLeaf で制御するか
			// AQSや標準スイッチャーの挙動に合わせるなら openLinkText
			const leaf = this.app.workspace.getLeaf(false);
			leaf.openFile(fileToOpen);
			this.close();
		} else {
			// 何も選択されていない場合、何もしないか閉じる
			// this.close();
		}
	}

	// 選択中のタブを閉じる (タブセクションのみ)
	closeSelectedTab() {
		if (this.activeSection !== 'tabs') return;
		
		const tab = this.filteredTabs[this.selectedTabIndex];
		if (!tab) return;
		
		tab.leaf.detach();
		
		// データ更新
		this.tabs = this.getTabs();
		this.performSearch(this.searchQuery); // 再フィルタリング
		this.renderAll();
	}

	// 選択中のタブをピン/アンピン
	pinSelectedTab() {
		if (this.activeSection !== 'tabs') return;
		
		const tab = this.filteredTabs[this.selectedTabIndex];
		if (!tab) return;
		
		tab.leaf.setPinned(!tab.isPinned);
		tab.isPinned = !tab.isPinned; // ローカル更新

		this.renderTabs(this.contentEl.querySelector('.tab-palette-list'));
	}

	// ファイルがブックマークされているかチェック
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

	// ブックマークを取得 (生データ)
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
	
	// 後方互換性のため残す（使わない）
	getBookmarks() { return this.getBookmarksList(); }

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// 設定タブ
class TabPaletteSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Tab Palette 設定' });

		// 除外フォルダ
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

		// タグを表示
		new Setting(containerEl)
			.setName('タグを表示')
			.setDesc('タブ一覧にタグを表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showTags)
				.onChange(async (value) => {
					this.plugin.settings.showTags = value;
					await this.plugin.saveSettings();
				}));

		// パスを表示
		new Setting(containerEl)
			.setName('パスを表示')
			.setDesc('タブ一覧にファイルパスを表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showPath)
				.onChange(async (value) => {
					this.plugin.settings.showPath = value;
					await this.plugin.saveSettings();
				}));

		// 並び順
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

		// 常に新しいタブで開く
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

// メインプラグインクラス
class TabPalettePlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		// タブパレットを開くコマンド
		this.addCommand({
			id: 'open-tab-palette',
			name: 'タブパレットを開く',
			callback: () => {
				new TabPaletteModal(this.app, this).open();
			}
		});

		// 前のタブに移動
		this.addCommand({
			id: 'go-to-previous-tab',
			name: '前のタブに移動',
			callback: () => {
				this.goToPreviousTab();
			}
		});

		// 次のタブに移動
		this.addCommand({
			id: 'go-to-next-tab',
			name: '次のタブに移動',
			callback: () => {
				this.goToNextTab();
			}
		});

		// 設定タブ
		this.addSettingTab(new TabPaletteSettingTab(this.app, this));

		// Always open in new tab 機能のモンキーパッチ
		this.registerMonkeyPatches();
	}

	// Workspace.getLeaf をオーバーライドして、常に新しいタブで開くようにする
	registerMonkeyPatches() {
		const plugin = this;

		// 元の getLeaf メソッドを保存
		const originalGetLeaf = Workspace.prototype.getLeaf;

		// getLeaf をオーバーライド
		Workspace.prototype.getLeaf = function(newLeaf) {
			// always open in new tab が有効な場合は、常に新しいタブで開く
			if (plugin.settings.alwaysOpenInNewTab) {
				// newLeaf が false または undefined の場合は、'tab' に変更
				if (!newLeaf) {
					newLeaf = 'tab';
				}
			}

			// 元のメソッドを呼び出す
			return originalGetLeaf.call(this, newLeaf);
		};

		// プラグインがアンロードされたときに元に戻す
		this.register(() => {
			Workspace.prototype.getLeaf = originalGetLeaf;
		});
	}

	// 前のタブに移動
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

	// 次のタブに移動
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

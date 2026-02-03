const { Plugin, Modal, PluginSettingTab, Setting, WorkspaceLeaf, Notice, setIcon, Workspace } = require('obsidian');

// デフォルト設定
const DEFAULT_SETTINGS = {
	excludedFolders: ['attachments', 'Attachments'],
	showTags: true,
	showPath: true,
	sortOrder: 'recency', // 'recency' または 'opening-order'
	alwaysOpenInNewTab: false,
	recentlyClosed: [], // 最近閉じたタブの履歴
	enableDailyNotes: true,
	dailyNoteFormat: 'YYYY-MM-DD (ddd)',
	dailyNoteFolder: '00_DailyNote'
};

// タブパレットモーダル
class TabPaletteModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;

		// 状態管理
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

		// IME入力中かどうかを追跡
		this.isComposing = false;
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
		this.dailyNotes = this.getDailyNotes();
		
		// 初期状態（全件表示）
		this.filteredTabs = this.tabs;
		this.filteredBookmarks = this.bookmarks;
		this.searchResults = []; // 初期は空にするか、全件出すか。ここでは空にする。

		// 3カラムコンテナを作成
		const columnsEl = contentEl.createDiv('tab-palette-columns');

		// --- 左カラム：Search ---
		const searchColumn = columnsEl.createDiv('tab-palette-column');
		searchColumn.createEl('h3', { text: 'Vault Search' });
		
		// 検索ボックスを左カラム内に配置
		const searchContainer = searchColumn.createDiv('tab-palette-search-container');
		this.searchInput = searchContainer.createEl('input', {
			type: 'text',
			cls: 'tab-palette-search-input',
			placeholder: 'Search vault...'
		});
		
		const searchList = searchColumn.createDiv('tab-palette-search-list');
		
		// --- 中央カラム：Open Tabs ---
		const tabsColumn = columnsEl.createDiv('tab-palette-column');
		tabsColumn.createEl('h3', { text: 'Tabs' });
		const tabList = tabsColumn.createDiv('tab-palette-list');
		
		// --- 右カラム：Bookmarks & Daily Notes ---
		const bookmarksColumn = columnsEl.createDiv('tab-palette-column');
		bookmarksColumn.createEl('h3', { text: 'Bookmarks' });
		const bookmarkList = bookmarksColumn.createDiv('tab-palette-bookmark-list');
		
		// Daily Notes セクション
		if (this.plugin.settings.enableDailyNotes) {
			const divider = bookmarksColumn.createEl('hr', { cls: 'tab-palette-section-divider' });
			const dailyNotesTitle = bookmarksColumn.createEl('h3', { text: 'Daily Notes' });
			dailyNotesTitle.addClass('daily-notes-title');
			const dailyNoteList = bookmarksColumn.createDiv('tab-palette-daily-note-list');
		}

		// 初回描画
		this.renderAll();

		// イベントリスナー設定
		this.searchInput.addEventListener('input', (e) => {
			// IME入力中も検索したい場合はここはそのままでOK。
			// もし確定後のみにしたい場合は compositionend イベントを使う手もあるが、
			// リアルタイム検索ならinputで良い。
			const query = e.target.value;
			this.performSearch(query);
			this.renderAll();
		});

		// IME入力の開始と終了を追跡
		this.searchInput.addEventListener('compositionstart', () => {
			this.isComposing = true;
		});

		this.searchInput.addEventListener('compositionend', () => {
			this.isComposing = false;
		});

		this.searchInput.addEventListener('keydown', (e) => {
			// IME変換中のEnterは無視（isComposingフラグもチェック）
			if (e.isComposing || this.isComposing) return;

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
			if (document.activeElement === this.searchInput) return; 
			enableKeyboardMode();
			this.switchSection('left');
			return false;
		});

		this.scope.register([], 'ArrowRight', (e) => {
			// 検索窓にフォーカスがある場合
			if (document.activeElement === this.searchInput) {
				// カーソルが末尾にあるかチェック
				const isAtEnd = this.searchInput.selectionStart === this.searchInput.value.length;
				if (!isAtEnd) return; // 末尾でなければ通常のカーソル移動を許可
				
				// 末尾なら次のセクションへ移動するためにフォーカスを外す
				this.searchInput.blur();
				this.modalEl.focus();
			}
			
			enableKeyboardMode();
			this.switchSection('right');
			return false;
		});

		this.scope.register([], 'Enter', (e) => {
			// IME変換中は無視
			if (e.isComposing || this.isComposing) return;
			this.openSelectedTab();
			return false;
		});

		// w キーでタブを閉じる
		this.scope.register([], 'w', (e) => {
			this.closeSelectedTab();
			return false;
		});

		// p キーでタブをピン/アンピン
		this.scope.register([], 'p', (e) => {
			this.pinSelectedTab();
			return false;
		});

		// 初期フォーカスとスクロール位置
		this.activeSection = 'tabs'; // 初期選択はOpen Tabs
		this.selectedTabIndex = 0;

		this.renderAll();

		// 検索窓のフォーカスを外して、モーダルにフォーカスを当てる
		// setTimeoutで遅延させて確実に動作させる
		setTimeout(() => {
			this.searchInput.blur();
			this.modalEl.focus();
			// 真ん中のカラムが見えるようにスクロール調整
			tabsColumn.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
		}, 10);
	}
	
	// 検索実行
	performSearch(query) {
		this.searchQuery = query.toLowerCase();
		
		// 1. Tabs フィルタリング -> しない（要望：検索結果は反映しないでほしい）
		this.filteredTabs = this.tabs;
		
		// 2. Bookmarks フィルタリング -> しない
		this.filteredBookmarks = this.bookmarks;
		
		// 3. Search Results (Vault全体)
		if (!this.searchQuery) {
			this.searchResults = []; 
		} else {
			this.searchResults = this.vaultFiles
				.filter(file => this.matchFile(file, this.searchQuery))
				.slice(0, 50);
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
		const dailyNoteContainer = this.contentEl.querySelector('.tab-palette-daily-note-list');
		
		if (searchContainer) this.renderSearchResults(searchContainer);
		if (tabContainer) this.renderTabs(tabContainer);
		if (bookmarkContainer) this.renderBookmarks(bookmarkContainer);
		if (dailyNoteContainer) this.renderDailyNotes(dailyNoteContainer);
		
		this.scrollToSelected();
	}

	// セクション切り替え
	switchSection(direction) {
		const sections = ['search', 'tabs', 'bookmarks'];
		if (this.plugin.settings.enableDailyNotes) {
			sections.push('dailyNotes');
		}
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

			// searchセクションに移動した時は検索窓にフォーカス
			if (nextSection === 'search') {
				this.searchInput.focus();
			}

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
		const openPaths = new Set();

		workspace.iterateAllLeaves((leaf) => {
			const viewState = leaf.getViewState();
			if (['markdown', 'canvas', 'image', 'pdf'].includes(viewState.type)) {
				// fileプロパティがない場合もあるためチェック
				let path = viewState.state.file;
				// view.file がある場合はそちらを優先（確実）
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

		// 最近閉じたタブを追加
		const recentlyClosed = this.plugin.settings.recentlyClosed || [];
		let firstClosed = true;

		recentlyClosed.forEach(closedTab => {
			// 現在開いているタブは除外
			if (openPaths.has(closedTab.path)) return;

			// ファイルが存在するか確認
			const file = this.app.vault.getAbstractFileByPath(closedTab.path);
			if (!file) return;

			// 除外フォルダチェック
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
			// bookmarksの一番下でArrowDownを押したらdailyNotesへ移動
			if (direction > 0 && this.selectedBookmarkIndex === this.filteredBookmarks.length - 1 && this.plugin.settings.enableDailyNotes && this.dailyNotes.length > 0) {
				this.activeSection = 'dailyNotes';
				this.selectedDailyNoteIndex = 0;
				this.renderAll();
			} else {
				this.selectedBookmarkIndex = this.clampIndex(this.selectedBookmarkIndex + direction, this.filteredBookmarks.length);
				this.renderBookmarks(this.contentEl.querySelector('.tab-palette-bookmark-list'));
			}
		} else if (this.activeSection === 'search') {
			this.selectedSearchIndex = this.clampIndex(this.selectedSearchIndex + direction, this.searchResults.length);
			this.renderSearchResults(this.contentEl.querySelector('.tab-palette-search-list'));
		} else if (this.activeSection === 'dailyNotes') {
			// dailyNotesの一番上でArrowUpを押したらbookmarksへ戻る
			if (direction < 0 && this.selectedDailyNoteIndex === 0 && this.filteredBookmarks.length > 0) {
				this.activeSection = 'bookmarks';
				this.selectedBookmarkIndex = this.filteredBookmarks.length - 1;
				this.renderAll();
			} else {
				this.selectedDailyNoteIndex = this.clampIndex(this.selectedDailyNoteIndex + direction, this.dailyNotes.length);
				this.renderDailyNotes(this.contentEl.querySelector('.tab-palette-daily-note-list'));
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
			if (tab) {
				leaf = tab.leaf;
				// 閉じたタブの場合は leaf がないので fileToOpen に設定
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
					// ファイルが存在しない場合は作成確認
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
		
		// Recently Closed に追加（既に閉じられているタブでなければ）
		if (tab.leaf) {
			const closedTabInfo = {
				path: tab.path,
				title: tab.name,
				basename: tab.name,
				extension: tab.file.extension
			};
			
			let updatedHistory = [...(this.plugin.settings.recentlyClosed || [])];
			// 履歴内の重複を削除して先頭に持ってくる
			updatedHistory = updatedHistory.filter(h => h.path !== closedTabInfo.path);
			updatedHistory.unshift(closedTabInfo);
			
			// 最大5件に制限
			if (updatedHistory.length > 5) {
				updatedHistory = updatedHistory.slice(0, 5);
			}
			
			this.plugin.settings.recentlyClosed = updatedHistory;
			this.plugin.saveSettings();
		}
		
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
	
	// デイリーノートを取得
	getDailyNotes() {
		if (!this.plugin.settings.enableDailyNotes) {
			return [];
		}

		const dailyNotes = [];
		const format = this.plugin.settings.dailyNoteFormat;
		const folder = this.plugin.settings.dailyNoteFolder;
		
		// moment.js を require （Obsidian に含まれている）
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
			
			// ファイルが存在しなくても配列に追加（exists フラグで管理）
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

	// デイリーノートをレンダリング
	renderDailyNotes(container) {
		container.empty();
		
		if (this.dailyNotes.length === 0) {
			container.createDiv({ text: 'No daily notes', cls: 'tab-palette-empty-message' });
			return;
		}
		
		this.dailyNotes.forEach((dailyNote, index) => {
			const itemEl = container.createDiv('tab-palette-bookmark-item');
			
			// 存在しない場合はグレー表示
			if (!dailyNote.exists) {
				itemEl.addClass('daily-note-not-exists');
			}
			
			if (this.activeSection === 'dailyNotes' && index === this.selectedDailyNoteIndex) {
				itemEl.addClass('is-selected');
			}
			
			// ファイル名で表示、ラベルは右側に
			const entryEl = itemEl.createDiv('tab-palette-entry');
			const leftEl = entryEl.createDiv('tab-palette-left');
			
			// ファイル名を表示
			const nameText = leftEl.createSpan('tab-palette-name-text');
			nameText.setText(dailyNote.name);
			
			// 右側にラベル（Today/Yesterday/Tomorrow）を表示
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
	
	// デイリーノート作成
	async createDailyNote(dailyNote) {
		const confirmed = confirm(`デイリーノート「${dailyNote.name}」を作成しますか？`);
		if (!confirmed) return;
		
		try {
			// テンプレートパスを取得（設定から）
			const dailyNotesPlugin = this.app.internalPlugins?.plugins?.['daily-notes'];
			let templatePath = '';
			if (dailyNotesPlugin && dailyNotesPlugin.instance) {
				templatePath = dailyNotesPlugin.instance.options?.template || '';
			}
			
			// ファイル作成
			let content = '';
			if (templatePath) {
				const templateFile = this.app.vault.getAbstractFileByPath(templatePath + '.md');
				if (templateFile) {
					content = await this.app.vault.read(templateFile);
				}
			}
			
			// フォルダが存在しない場合は作成
			const folder = this.plugin.settings.dailyNoteFolder;
			if (folder) {
				const folderExists = this.app.vault.getAbstractFileByPath(folder);
				if (!folderExists) {
					await this.app.vault.createFolder(folder);
				}
			}
			
			// ファイル作成
			const newFile = await this.app.vault.create(dailyNote.path, content);
			
			// ファイルを開く
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(newFile);
			
			this.close();
		} catch (error) {
			new Notice(`デイリーノートの作成に失敗しました: ${error.message}`);
		}
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

		// デイリーノートを有効化
		new Setting(containerEl)
			.setName('デイリーノートセクションを表示')
			.setDesc('タブパレットにデイリーノート（昨日・今日・明日）を表示する')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDailyNotes)
				.onChange(async (value) => {
					this.plugin.settings.enableDailyNotes = value;
					await this.plugin.saveSettings();
				}));

		// デイリーノート日付フォーマット
		new Setting(containerEl)
			.setName('デイリーノート日付フォーマット')
			.setDesc('moment.js形式（例: YYYY-MM-DD (ddd)）')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD (ddd)')
				.setValue(this.plugin.settings.dailyNoteFormat)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteFormat = value || 'YYYY-MM-DD (ddd)';
					await this.plugin.saveSettings();
				}));

		// デイリーノート保存先フォルダ
		new Setting(containerEl)
			.setName('デイリーノート保存先フォルダ')
			.setDesc('デイリーノートが保存されているフォルダパス')
			.addText(text => text
				.setPlaceholder('00_DailyNote')
				.setValue(this.plugin.settings.dailyNoteFolder)
				.onChange(async (value) => {
					this.plugin.settings.dailyNoteFolder = value || '00_DailyNote';
					await this.plugin.saveSettings();
				}));
	}
}

// メインプラグインクラス
class TabPalettePlugin extends Plugin {
	async onload() {
		await this.loadSettings();
		
		// 閉じたタブ検知用の状態初期化
		this.lastOpenTabs = this.getOpenTabsInfo();
		
		// レイアウト変更を監視して閉じたタブを検知
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.detectClosedTabs();
			})
		);

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

	// 現在開いているタブの情報を取得
	getOpenTabsInfo() {
		const leaves = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			const viewState = leaf.getViewState();
			// 対象とするファイルタイプ
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

	// 閉じたタブを検知して履歴に保存
	detectClosedTabs() {
		const currentTabs = this.getOpenTabsInfo();
		
		// 以前あって今ないものを探す
		const closedTabs = this.lastOpenTabs.filter(lastTab => 
			!currentTabs.some(currTab => currTab.path === lastTab.path)
		);

		if (closedTabs.length > 0) {
			let updatedHistory = [...(this.settings.recentlyClosed || [])];
			
			// 新しい閉じたタブを先頭に追加
			closedTabs.forEach(tab => {
				// 履歴内の重複を削除して先頭に持ってくる
				updatedHistory = updatedHistory.filter(h => h.path !== tab.path);
				updatedHistory.unshift(tab);
			});

			// 最大5件に制限
			if (updatedHistory.length > 5) {
				updatedHistory = updatedHistory.slice(0, 5);
			}

			this.settings.recentlyClosed = updatedHistory;
			this.saveSettings();
		}

		this.lastOpenTabs = currentTabs;
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

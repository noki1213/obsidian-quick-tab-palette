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
		this.selectedIndex = 0;
		this.tabs = [];
		this.bookmarks = [];
		this.allItems = []; // tabs と bookmarks を統合したリスト
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('tab-palette-modal');

		// タブ一覧を取得
		this.tabs = this.getFilteredTabs();
		
		// ブックマークを取得
		this.bookmarks = this.getBookmarks();
		
		// 統合リストを作成（tabs + bookmarks）
		this.allItems = [
			...this.tabs.map(tab => ({ type: 'tab', data: tab })),
			...this.bookmarks.map(bookmark => ({ type: 'bookmark', data: bookmark }))
		];

		// タイトル
		contentEl.createEl('h3', { text: 'Open Tabs' });

		// タブリスト
		const tabList = contentEl.createDiv('tab-palette-list');
		this.renderTabs(tabList);

		// ブックマークセクション
		if (this.bookmarks.length > 0) {
			// 区切り線
			contentEl.createEl('hr', { cls: 'tab-palette-separator' });

			// ブックマークタイトル
			contentEl.createEl('h3', { text: 'Bookmarks' });

			// ブックマークリスト
			const bookmarkList = contentEl.createDiv('tab-palette-bookmark-list');
			this.renderBookmarks(bookmarkList);
		}

		// マウスカーソルの表示/非表示を制御
		const modalEl = this.modalEl;

		// マウス移動でカーソルを表示
		modalEl.addEventListener('mousemove', () => {
			modalEl.removeClass('is-keyboard-mode');
		});

		// キーボード操作でカーソルを非表示
		const enableKeyboardMode = () => {
			modalEl.addClass('is-keyboard-mode');
		};

		// キーボードイベント
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

	// 除外フォルダをフィルタリングしてタブを取得
	getFilteredTabs() {
		const tabs = [];
		const workspace = this.app.workspace;

		workspace.iterateAllLeaves((leaf) => {
			const viewState = leaf.getViewState();
			if (viewState.type === 'markdown' || viewState.type === 'canvas') {
				const file = this.app.vault.getAbstractFileByPath(viewState.state.file);

				if (file) {
					// 除外フォルダのチェック
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

		// 並び順
		if (this.plugin.settings.sortOrder === 'recency') {
			// 履歴順（最近開いた順）
			tabs.sort((a, b) => {
				const timeA = a.leaf.activeTime || 0;
				const timeB = b.leaf.activeTime || 0;
				return timeB - timeA;
			});
		}

		return tabs;
	}

	// タブを表示
	renderTabs(container) {
		container.empty();

		this.tabs.forEach((tab, index) => {
			const tabEl = container.createDiv('tab-palette-item');

			// 統合リストでの選択状態を確認
			if (index === this.selectedIndex) {
				tabEl.addClass('is-selected');
			}

			if (tab.isPinned) {
				tabEl.addClass('is-pinned');
			}

			// メインの1行コンテナ
			const entryEl = tabEl.createDiv('tab-palette-entry');

			// 左側：ピンアイコン + タブ名 + タグ
			const leftEl = entryEl.createDiv('tab-palette-left');

			// ピンアイコン
			if (tab.isPinned) {
				const pinIcon = leftEl.createSpan('tab-palette-pin-icon');
				setIcon(pinIcon, 'pin');
			}

			// ブックマークアイコン
			if (tab.isBookmarked) {
				const starIcon = leftEl.createSpan('tab-palette-star-icon');
				setIcon(starIcon, 'star');
			}

			// タブ名
			const nameText = leftEl.createSpan('tab-palette-name-text');
			nameText.setText(tab.name);

			// タグ（タイトルの右側）
			if (this.plugin.settings.showTags) {
				// ファイルのメタデータからタグを取得
				const cache = this.app.metadataCache.getFileCache(tab.file);
				const allTags = [];

				// インライン形式のタグ（本文中の #tag）
				if (cache && cache.tags) {
					allTags.push(...cache.tags.map(t => t.tag));
				}

				// フロントマターのタグ
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

			// 右側：パス
			if (this.plugin.settings.showPath) {
				const rightEl = entryEl.createDiv('tab-palette-right');

				// フォルダアイコン
				const folderIcon = rightEl.createSpan('tab-palette-folder-icon');
				setIcon(folderIcon, 'folder');

				// パス
				const pathEl = rightEl.createSpan('tab-palette-path');
				// ディレクトリ部分のみを表示（ファイル名を除く）
				const pathParts = tab.path.split('/');
				pathParts.pop(); // 最後の要素（ファイル名）を除く
				const dirPath = pathParts.join('/') || '/';
				pathEl.setText(dirPath);
			}

			// クリックイベント
			tabEl.addEventListener('click', () => {
				this.selectedIndex = index;
				this.openSelectedTab();
			});
		});
	}

	// 選択を移動
	moveSelection(direction) {
		this.selectedIndex += direction;

		// 統合リストの長さでループ
		const totalItems = this.allItems.length;
		if (this.selectedIndex < 0) {
			this.selectedIndex = totalItems - 1;
		} else if (this.selectedIndex >= totalItems) {
			this.selectedIndex = 0;
		}

		// 両方のリストを再描画
		const tabContainer = this.contentEl.querySelector('.tab-palette-list');
		const bookmarkContainer = this.contentEl.querySelector('.tab-palette-bookmark-list');
		this.renderTabs(tabContainer);
		if (bookmarkContainer) {
			this.renderBookmarks(bookmarkContainer);
		}
		
		// 選択項目を表示範囲内にスクロール
		this.scrollToSelected();
	}
	
	// 選択中の項目をスクロールして表示
	scrollToSelected() {
		const selectedEl = this.contentEl.querySelector('.is-selected');
		if (selectedEl) {
			selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		}
	}

	// 選択中のタブを開く
	openSelectedTab() {
		const selectedItem = this.allItems[this.selectedIndex];
		if (!selectedItem) return;
		
		if (selectedItem.type === 'tab') {
			// タブの場合：そのタブをアクティブに
			this.app.workspace.setActiveLeaf(selectedItem.data.leaf, { focus: true });
		} else {
			// ブックマークの場合：ファイルを開く
			this.app.workspace.openLinkText(selectedItem.data.path, '', false);
		}
		this.close();
	}

	// 選択中のタブを閉じる
	closeSelectedTab() {
		const selectedItem = this.allItems[this.selectedIndex];
		if (!selectedItem || selectedItem.type !== 'tab') return; // タブのみ閉じられる
		
		const tab = selectedItem.data;
		tab.leaf.detach();
		
		// tabs配列から削除
		const tabIndex = this.tabs.indexOf(tab);
		if (tabIndex !== -1) {
			this.tabs.splice(tabIndex, 1);
		}
		
		// allItemsを再構築
		this.allItems = [
			...this.tabs.map(t => ({ type: 'tab', data: t })),
			...this.bookmarks.map(b => ({ type: 'bookmark', data: b }))
		];

		if (this.selectedIndex >= this.allItems.length) {
			this.selectedIndex = Math.max(0, this.allItems.length - 1);
		}

		// タブがなくなったら閉じる
		if (this.allItems.length === 0) {
			this.close();
		} else {
			// 再描画
			const tabContainer = this.contentEl.querySelector('.tab-palette-list');
			const bookmarkContainer = this.contentEl.querySelector('.tab-palette-bookmark-list');
			this.renderTabs(tabContainer);
			if (bookmarkContainer) {
				this.renderBookmarks(bookmarkContainer);
			}
		}
	}

	// 選択中のタブをピン/アンピン
	pinSelectedTab() {
		const selectedItem = this.allItems[this.selectedIndex];
		if (!selectedItem || selectedItem.type !== 'tab') return; // タブのみピン可能
		
		const tab = selectedItem.data;
		tab.leaf.setPinned(!tab.isPinned);
		tab.isPinned = !tab.isPinned;

		// 再描画
		const tabContainer = this.contentEl.querySelector('.tab-palette-list');
		const bookmarkContainer = this.contentEl.querySelector('.tab-palette-bookmark-list');
		this.renderTabs(tabContainer);
		if (bookmarkContainer) {
			this.renderBookmarks(bookmarkContainer);
		}
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

	// ブックマークを取得
	getBookmarks() {
		const bookmarks = [];
		const bookmarkPlugin = this.app.internalPlugins?.plugins?.bookmarks;

		if (!bookmarkPlugin || !bookmarkPlugin.enabled) {
			return bookmarks;
		}

		const bookmarkItems = bookmarkPlugin.instance?.items || [];

		bookmarkItems.forEach(item => {
			// ファイルのブックマークのみを取得
			if (item.type === 'file' && item.path) {
				const file = this.app.vault.getAbstractFileByPath(item.path);
				if (file) {
					// 除外フォルダのチェック
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

	// ブックマークを表示
	renderBookmarks(container) {
		container.empty();

		this.bookmarks.forEach((bookmark, index) => {
			const itemEl = container.createDiv('tab-palette-bookmark-item');
			
			// 統合リストでの選択状態を確認（tabs.length + index）
			const globalIndex = this.tabs.length + index;
			if (globalIndex === this.selectedIndex) {
				itemEl.addClass('is-selected');
			}

			// メインの1行コンテナ
			const entryEl = itemEl.createDiv('tab-palette-entry');

			// 左側：スターアイコン + ファイル名
			const leftEl = entryEl.createDiv('tab-palette-left');

			// スターアイコン
			const starIcon = leftEl.createSpan('tab-palette-star-icon');
			setIcon(starIcon, 'star');

			// ファイル名
			const nameText = leftEl.createSpan('tab-palette-name-text');
			nameText.setText(bookmark.name);

			// タグ（ブックマークにもタグを表示）
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

			// 右側：パス
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

			// クリックイベント
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

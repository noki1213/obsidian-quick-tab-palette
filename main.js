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
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass('tab-palette-modal');

		// タブ一覧を取得
		this.tabs = this.getFilteredTabs();

		// タイトル
		contentEl.createEl('h3', { text: 'Tab Palette' });

		// タブリスト
		const tabList = contentEl.createDiv('tab-palette-list');
		this.renderTabs(tabList);

		// キーボードイベント
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
							isPinned: leaf.pinned
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

		if (this.selectedIndex < 0) {
			this.selectedIndex = this.tabs.length - 1;
		} else if (this.selectedIndex >= this.tabs.length) {
			this.selectedIndex = 0;
		}

		// 再描画
		const container = this.contentEl.querySelector('.tab-palette-list');
		this.renderTabs(container);
	}

	// 選択中のタブを開く
	openSelectedTab() {
		const tab = this.tabs[this.selectedIndex];
		if (tab) {
			this.app.workspace.setActiveLeaf(tab.leaf, { focus: true });
			this.close();
		}
	}

	// 選択中のタブを閉じる
	closeSelectedTab() {
		const tab = this.tabs[this.selectedIndex];
		if (tab) {
			tab.leaf.detach();
			this.tabs.splice(this.selectedIndex, 1);

			if (this.selectedIndex >= this.tabs.length) {
				this.selectedIndex = Math.max(0, this.tabs.length - 1);
			}

			// タブがなくなったら閉じる
			if (this.tabs.length === 0) {
				this.close();
			} else {
				// 再描画
				const container = this.contentEl.querySelector('.tab-palette-list');
				this.renderTabs(container);
			}
		}
	}

	// 選択中のタブをピン/アンピン
	pinSelectedTab() {
		const tab = this.tabs[this.selectedIndex];
		if (tab) {
			tab.leaf.setPinned(!tab.isPinned);
			tab.isPinned = !tab.isPinned;

			// 再描画
			const container = this.contentEl.querySelector('.tab-palette-list');
			this.renderTabs(container);
		}
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

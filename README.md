> Japanese documentation is available below. (日本語ドキュメントは下部にあります)

# Quick Tab Palette

An Obsidian plugin for advanced tab management. Open a palette to search, switch, close, pin, and bookmark tabs, all from the keyboard.

## Features

### Tab Palette Modal (3-Column Layout)

A modal with up to 3 columns that gives you quick access to everything in your vault.

- Left column - Vault Search: Search all files by filename, path, or tags. Up to 50 results displayed.
- Center column - Tabs: View all currently open tabs. Includes a Recently Closed section showing up to 5 recently closed tabs that can be reopened.
- Right column - Bookmarks and Daily Notes: View your Obsidian bookmarks and daily notes for Yesterday, Today, and Tomorrow.

Each column can be independently enabled or disabled in settings.

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow Up / Down | Move selection within a column |
| Arrow Left / Right | Switch between columns |
| Enter | Open the selected item |
| w | Close the selected tab |
| p | Toggle pin on the selected tab |
| b | Toggle bookmark on the selected item |

Japanese IME input is fully supported in the search box.

When using the keyboard, the mouse cursor is hidden automatically to reduce visual distraction. It reappears when you move the mouse.

### Commands

- Open Quick Tab Palette: Opens the palette modal
- Go to Previous Tab: Switch to the previous tab (wraps around)
- Go to Next Tab: Switch to the next tab (wraps around)

All commands can be assigned custom hotkeys in Obsidian settings.

### Always Open in New Tab

When enabled, all links and files open in a new tab instead of replacing the current one. This modifies Obsidian's internal behavior. Sub-settings include:

- Tab deduplication: If the same file is already open, switches to that tab instead of opening a duplicate.
- New tab placement: Choose where new tabs appear - after the active tab, after pinned tabs, at the beginning, or at the end.
- Tab group placement: When using split panes, choose which group new tabs open in - same group, opposite group, first group, or last group.
- Ctrl/Cmd+Click behavior is inverted: Opens in the same tab instead of a new tab, since new tab is now the default.

### Daily Notes

- Displays Yesterday, Today, and Tomorrow daily notes in the right column.
- If a daily note does not exist, you can create it directly from the palette with a confirmation dialog.
- Supports templates from Obsidian's built-in Daily Notes plugin.
- Configurable date format (moment.js) and folder path.

### Display

- Pinned tabs are marked with a pin icon and a left border accent.
- Bookmarked items are marked with a star icon.
- Tags from both inline tags and frontmatter are displayed next to file names.
- File paths are shown with a folder icon.
- Tab sort order: by recency (most recently active first) or by opening order (matching the tab bar).
- Excluded folders: hide specific folders from all lists (comma-separated).

### Responsive Layout

When the window is narrow, columns maintain a minimum width and the palette becomes horizontally scrollable.

## Installation

### Via BRAT

1. Install the BRAT plugin.
2. Add `noki1213/obsidian-quick-tab-palette` as a beta plugin.

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `quick-tab-palette` in your vault's `.obsidian/plugins/` directory.
3. Place the downloaded files in that folder.
4. Enable the plugin in Obsidian settings.

## Settings

### Section Visibility

- Search: Show or hide the Vault Search column.
- Tabs: Show or hide the open tabs column.
- Bookmarks: Show or hide the bookmarks list.
- Daily Notes: Show or hide the daily notes section.

### Display Options

- Show file path: Display folder paths for each item.
- Show tags: Display tags for each item.
- Excluded folders: Folders to hide from all lists (comma-separated).

### Behavior

- Tab sort order: Recency or opening order.
- Always open in new tab: Force all files to open in new tabs.
  - Deduplicate tabs: Prevent duplicate tabs for the same file.
  - New tab placement: After active, after pinned, beginning, or end.
  - Tab group placement: Same, opposite, first, or last.

### Daily Notes Settings

- Date format: moment.js format string (e.g., YYYY-MM-DD (ddd)).
- Folder: Path to the daily notes folder.

---

# Quick Tab Palette

Obsidian 用の高機能タブ管理プラグインです。パレットを開いて、キーボードだけでタブの検索・切り替え・閉じる・ピン留め・ブックマークができます。

## 機能

### タブパレットモーダル（3カラムレイアウト）

Vault 内のすべてにすばやくアクセスできる、最大3カラム構成のモーダルです。

- 左カラム - Vault 検索: ファイル名・パス・タグでファイルを検索できます。最大50件まで表示されます。
- 中央カラム - タブ: 現在開いているタブの一覧です。最近閉じたタブ（最大5件）も表示され、再び開くことができます。
- 右カラム - ブックマークとデイリーノート: Obsidian のブックマーク一覧と、昨日・今日・明日のデイリーノートを表示します。

各カラムは設定で個別に表示・非表示を切り替えられます。

### キーボード操作

| キー | 動作 |
|------|------|
| 上下キー | カラム内で選択を移動 |
| 左右キー | カラム間を移動 |
| Enter | 選択した項目を開く |
| w | 選択したタブを閉じる |
| p | 選択したタブのピン留めを切り替える |
| b | 選択した項目のブックマークを切り替える |

検索ボックスでは日本語 IME 入力に対応しています。

キーボード操作中はマウスカーソルが自動的に非表示になります。マウスを動かすと再び表示されます。

### コマンド

- Quick Tab Palette を開く: パレットモーダルを開きます。
- 前のタブに移動: 前のタブに切り替えます（末尾まで行くと先頭に戻ります）。
- 次のタブに移動: 次のタブに切り替えます（先頭まで行くと末尾に戻ります）。

すべてのコマンドに Obsidian の設定からカスタムホットキーを割り当てられます。

### 常に新しいタブで開く

有効にすると、すべてのリンクやファイルが現在のタブを置き換えずに新しいタブで開きます。Obsidian の内部動作を変更する機能です。詳細設定は以下の通りです。

- 重複タブの防止: 同じファイルがすでに開いている場合、新しいタブを作らずにそのタブに切り替えます。
- 新しいタブの位置: 現在のタブの後ろ、ピン留めタブの後ろ、先頭、末尾から選べます。
- タブグループの配置: 分割表示している場合、同じグループ、反対側のグループ、最初のグループ、最後のグループから選べます。
- Ctrl/Cmd+クリックの動作が逆転: 新しいタブがデフォルトになるため、Ctrl/Cmd+クリックで同じタブに開くようになります。

### デイリーノート

- 昨日・今日・明日のデイリーノートを右カラムに表示します。
- デイリーノートが存在しない場合、確認ダイアログの後にパレットから直接作成できます。
- Obsidian 内蔵のデイリーノートプラグインのテンプレートに対応しています。
- 日付フォーマット（moment.js 形式）とフォルダパスを設定できます。

### 表示

- ピン留めされたタブにはピンアイコンと左ボーダーが表示されます。
- ブックマークされた項目にはスターアイコンが表示されます。
- インラインタグとフロントマターのタグがファイル名の横に表示されます。
- ファイルパスがフォルダアイコンと共に表示されます。
- タブの並び順: 履歴順（最近アクティブだった順）または開いた順（タブバーの並び）。
- 除外フォルダ: 特定のフォルダをすべてのリストから非表示にします（カンマ区切り）。

### レスポンシブレイアウト

ウィンドウ幅が狭い場合、各カラムは最小幅を維持し、横スクロールで操作できます。

## インストール

### BRAT 経由

1. BRAT プラグインをインストールします。
2. `noki1213/obsidian-quick-tab-palette` をベータプラグインとして追加します。

### 手動インストール

1. 最新リリースから `main.js`、`manifest.json`、`styles.css` をダウンロードします。
2. Vault の `.obsidian/plugins/` に `quick-tab-palette` フォルダを作成します。
3. ダウンロードしたファイルをそのフォルダに配置します。
4. Obsidian の設定でプラグインを有効にします。

## 設定

### セクションの表示設定

- 検索: Vault 検索カラムの表示・非表示。
- タブ: 開いているタブカラムの表示・非表示。
- ブックマーク: ブックマーク一覧の表示・非表示。
- デイリーノート: デイリーノートセクションの表示・非表示。

### 表示オプション

- ファイルパスを表示: 各項目にフォルダパスを表示する。
- タグを表示: 各項目にタグを表示する。
- 除外フォルダ: すべてのリストから非表示にするフォルダ（カンマ区切り）。

### 動作設定

- タブの並び順: 履歴順または開いた順。
- 常に新しいタブで開く: すべてのファイルを新しいタブで開く。
  - 重複タブを防止: 同じファイルの重複タブを防ぐ。
  - 新しいタブの位置: 現在のタブの後ろ、ピン留めタブの後ろ、先頭、末尾。
  - タブグループの配置: 同じグループ、反対側、最初、最後。

### デイリーノート設定

- 日付フォーマット: moment.js 形式の文字列（例: YYYY-MM-DD (ddd)）。
- 保存先フォルダ: デイリーノートフォルダのパス。

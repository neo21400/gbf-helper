# GBF Helper Extension

A browser extension for Granblue Fantasy bundling several independent tools:

* **Loot Tracker** — records raid drops automatically and shows them in a separate window (favorites, pinning, JSON export/import).
* **Evoker Calculator** — tracks remaining materials for every Evoker crafting stage, with optional sync to a server.
* **Gacha Tracker** — records pulls automatically: periods, spark counter, dropped SSRs, weapon → character resolution.
* **Auto-Clicker** *(optional)* — records and replays click macros with jitter, captcha/low-AP detection, and sound alerts.

## Installation

Every [release](https://github.com/neo21400/gbf-helper/releases/latest) ships two archives. They are the same extension; the difference is the Auto-Clicker.

| | `gbf-helper-<version>.zip` | `gbf-helper-<version>-no-clicker.zip` |
|---|---|---|
| Loot Tracker, Evoker Calculator, Gacha Tracker | yes | yes |
| Auto-Clicker | yes | no |
| `debugger` permission | requested | not requested |
| "started debugging this browser" warning | while the clicker is attached | never |

The Auto-Clicker needs the `debugger` permission — that is what lets it dispatch real mouse events — and Chrome keeps the warning on screen the whole time it is attached. If you don't need the clicker, take the `no-clicker` build and the warning never appears.

To install: unzip, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the unpacked `gbf-helper` folder.

Chrome treats the two builds as the same extension, so they share their data. You can move from one to the other — in any folder — without losing loot history, calculator progress, recorded macros or window positions.

## Usage

Click the extension icon in the toolbar — the popup menu opens the tool you need. Loot Tracker, Calculator and Gacha Tracker each open in their own window and remember their size and position; the Auto-Clicker gets a compact control panel.

The Loot and Gacha trackers need the game tab open — they read the game's own responses, so keep `game.granbluefantasy.jp` running while you play.

## Updating

**Check for Updates** in the popup tells you whether a newer version has been released, and opens the release page if there is one.

It can't install the update for you — Chrome only updates extensions that came from the Web Store. So updating stays manual: unzip the new archive over the old folder and press **Reload** on the extension card in `chrome://extensions`.

## The calculator also has a standalone page

The Evoker Calculator exists both inside the extension and as a standalone web page at **https://gbf.keka312.com**. They work against the same account and the same server-side data — but on your machine they are two independent things.

Each keeps its own local copy of your progress, and you sign in to each one separately. Nothing crosses over locally: the two meet only on the server, so progress entered in one shows up in the other after a sync. The page syncs when it loads; the extension syncs once per browser session, after every change, and on demand via **Sync Now** in the popup.

## License

GNU GPL v3 — see [LICENSE](LICENSE).

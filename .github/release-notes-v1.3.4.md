---

### What's new in {{VERSION}}

**Added**

* **Backfill from history** — pulls in loot from battles the tracker never saw, fought on a phone or another machine. **Scan new** catches up to what's already recorded, **Scan all history** walks the whole history and resumes where it stopped. Needs the game open in a tab.
* **Item names for imported drops** — the history gives only an item's number, so those drops used to show as `#534`. Names come from your item screen, the rest are asked about one at a time. Runs once per browser start, or on demand with **🏷 Fix item names**.
* **Drop history** — click an item in a chest section to see the gap before each of its drops, not just the wait since the last one. Counted within one chest type; pinned items show it in a popup.
* **Item names in the JSON export** — `my_data.json` used to hold bare numbers for imported loot.

**Fixed**

* Tool windows refused to open after a monitor was unplugged or the screen got smaller.
* Assorted bug fixes.

Loot history, pins, gacha history and calculator progress carry over from 1.3.3 untouched. No new permissions are requested.

---

### What's new in {{VERSION}}

**The Auto-Clicker panel is now in English.** Its interface was the last part of the extension still written in Russian. Nothing about how it works changed — buttons, statuses and the settings dialog just say the same things in English. Recorded macros and saved settings carry over untouched.

**The Gacha Tracker uses the width of its window.** Cards were stretching to fill the row, so a wide window meant huge portraits with everything still running straight down the page. Cards are now a fixed size, and when there's room to the right the categories move into it instead of stacking — the same column layout the Loot Tracker uses. Narrow windows are unchanged: one column, everything below each other.

**You can choose how drops are shown.** Two controls in the header of the tracker window:

* **Order drawn** — every SSR of the period in one run, in the order it came out of the banner. Nothing is grouped, so nothing leaves half-empty strips behind.
* **By type** — the sections below, plus a second control for whether they sit under each other (**Rows**) or spread across the width (**Columns**).

The choice is remembered.

**Summons have their own section in the Gacha Tracker.** They used to land in **Other SSR** together with weapons that don't unlock a character. The three sections are now **Characters**, **Summons** and **Other SSR**.

**A banner can be saved as a picture.** **🖼 Image** in a period's header writes a PNG of that banner: the dates and the draw counter up top, then three columns — **New**, **Already owned** and **Summons**. Built from what the tracker already recorded, so there's nothing to fill in by hand.

The SSR rate on it is counted against *recorded* draws, not the game's own counter. If some pulls happened before the extension was installed or on another device, the image says so instead of quietly rating a banner on incomplete data.

The spark sits in the column it belongs to — summons with the summons, otherwise among the new ones or the ones you already had — outlined in gold and tagged so it's still clear it was picked rather than pulled.

**The spark field suggests names.** It offers matching SSR characters and summons from the wiki as you type. Picking one from the list is what lets the spark appear on the image — a name typed by hand is still kept, just shown as text. The **New** checkbox next to it decides which column the spark goes to: the game never tells us whether a sparked item was new, since it never dropped.

*This build asks for one new permission:* access to the game's asset CDN. It's what makes the banner image possible — the images have to be fetched by the extension itself, otherwise the browser refuses to let a picture be saved out of them. Nothing else uses it.

Loot history, pins, gacha history and calculator progress carry over from 1.3.2 untouched.

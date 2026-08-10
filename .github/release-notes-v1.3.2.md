---

### What's new in {{VERSION}}

**Fix: collapsed chest sections are now remembered per raid.** They were stored as one list shared by every raid, so collapsing the chests of one raid collapsed them for all the others as soon as the page was reloaded. Most visible in the **Favorites** tab, where several raids are on screen at once.

One-time side effect of the fix: sections collapsed before this update are forgotten, so everything starts expanded once.

**The Gacha Tracker can now download and upload its history.** Two buttons at the top of the window: **Download** saves every recorded period to a JSON file, **Upload** reads one back. An imported file is merged with what's already there rather than replacing it — periods you don't have are added, draws already recorded aren't duplicated, and for the game's own draw counter and the spark character the more recent record wins. It's the same merge the server sync uses, so importing on one machine and syncing from another can't lose data. If you're signed in, imported periods are uploaded automatically.

**Fix: the update check now notices a new release right away.**

Loot history, pins and all other data carry over from 1.3.1 untouched.

Two builds of the same extension — pick one.

| | `gbf-helper-{{VERSION}}.zip` | `gbf-helper-{{VERSION}}-no-clicker.zip` |
|---|---|---|
| Loot Tracker, Evoker Calculator, Gacha Tracker | yes | yes |
| Auto-Clicker | yes | no |
| `debugger` permission | requested | not requested |
| "started debugging this browser" warning | while the clicker is attached | never |

The Auto-Clicker needs the `debugger` permission — that is what lets it dispatch real mouse events — and Chrome shows the debugging warning the whole time it is attached. Take the `no-clicker` build if you don't need it, and the warning never appears.

Both builds are the same extension and share one `chrome.storage`, so you can move from one to the other without losing loot history, calculator progress, recorded macros or window positions.

**Install:** unzip, open `chrome://extensions`, turn on Developer mode, click Load unpacked and pick the unpacked `gbf-helper` folder.

**Update:** unzip the new archive over the old folder, then press Reload on the extension card.

Two builds of the same extension — pick one.

| | `gbf-helper-{{VERSION}}.zip` | `gbf-helper-{{VERSION}}-no-clicker.zip` |
|---|---|---|
| Loot Tracker, Evoker Calculator, Gacha Tracker | yes | yes |
| Auto-Clicker | yes | no |
| `debugger` permission | requested | not requested |
| "started debugging this browser" warning | while the clicker is attached | never |

The Auto-Clicker needs the `debugger` permission — that is what lets it dispatch real mouse events — and Chrome shows the debugging warning the whole time it is attached. Take the `no-clicker` build if you don't need it, and the warning never appears.

> [!WARNING]
> **The Auto-Clicker is used at your own risk.** Automating play is against Granblue Fantasy's terms of service, and accounts get suspended or permanently banned for it. Jitter, human-like cursor movement and captcha detection change nothing about that — the clicker dispatches input on your behalf, which is exactly what the rules forbid, and nobody can appeal a ban for you. Take the `no-clicker` build if you would rather not have the option on your machine at all.
>
> The Loot Tracker, Evoker Calculator and Gacha Tracker don't automate anything — they only read responses the game sends to your own browser.

Both builds are the same extension and share one `chrome.storage`, so you can move from one to the other without losing loot history, calculator progress, recorded macros or window positions.

**Install:** unzip, open `chrome://extensions`, turn on Developer mode, click Load unpacked and pick the unpacked `gbf-helper` folder.

**Update:** unzip the new archive over the old folder, then press Reload on the extension card.

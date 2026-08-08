---

### Updating from 1.2 or earlier: read this first

This release pins the extension ID with a manifest `key`, so that both builds are the same extension in any folder. Chrome used to derive the ID from the folder path, which means it sees this version as a **new** extension and starts with an empty `chrome.storage`.

It happens once — after this update the ID never changes again.

Before you update:

1. Sign in on the popup and press **Sync Now**. Calculator progress, loot history and gacha periods live on the server and come back once you sign in again on the new install.
2. Export your loot to JSON from the Loot Tracker if you don't use sync.

What does not survive, because it is never synced: recorded clicker macros, jitter and volume settings, saved window sizes and positions, and the gacha capture toggle. Macros have to be recorded again.

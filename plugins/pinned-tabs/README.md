# pinned-tabs

The tab bar at the top of pasode's chats shows your pinned chats instead of every chat you've opened:

```
1 webapp ⠋  2 api review   3 docs ●   release notes
```

- **Pinned tabs:** the chats you pinned in Paseo, in the order you pinned them. Pins are shared with the desktop and phone apps, so pinning or unpinning anywhere updates the bar right away. To pin or unpin in pasode, open the chat switcher with ctrl+x l.
- **Temporary tab:** when the chat on screen isn't pinned, it shows in italics at the end of the bar, with no number. It goes away when you open another chat.
- **Markers:** a spinner while a chat runs, △ when it waits for a permission, ✕ after an error, and ● when it has news you haven't read.

Click a tab to open its chat. The bar hides while the only tab is the chat on screen, and in terminals narrower than 40 columns.

Pinning works per workspace, like the chat switcher: a workspace with several chats in it doesn't get a tab.

## Turn off pasode's own tabs

pasode has its own tab bar, which lists every chat you open in it. This plugin stays hidden while that bar is on, so the two bars and their keys don't clash. To switch over, open the settings with ctrl+p and **Open settings**, then set **Session tabs** to **off**. pasode remembers the choice.

## Keys

| Key | Action |
| --- | --- |
| ctrl+x 1–9 | Opens pinned chat 1–9. |
| ctrl+x . | Opens the next pinned chat. |
| ctrl+x , | Opens the previous pinned chat. |

The keys are the same as pasode's own tab keys and use your `leader` key. The [sound](../sound) plugin plays sounds for pinned chats as well as open tabs.

## Options

None.

```jsonc
"~/pasode-plugins/plugins/pinned-tabs"
```

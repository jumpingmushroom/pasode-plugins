# clock

A big clock at the top of pasode's sidebar, right under the chat's title. The time is drawn in block digits 3 lines tall, so you can read it at a glance, with the date below:

```
 ▀█  █▀▀ ▄ ▀▀█ ▀█
  █  █▀█ ▄ █▀▀  █
 ▄█▄ █▄█   █▄▄ ▄█▄
tirsdag 3. november
```

The clock updates on the minute, or every second with `seconds` on. Like the rest of the sidebar, it shows in chats, not on the home screen.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `seconds` | `false` | Adds small seconds after the minutes. |
| `date` | `true` | Shows the date below the clock. |
| `hour12` | `false` | Shows a 12-hour clock with AM or PM. |
| `locale` | `"nb-NO"` | Language of the date, such as `"nb-NO"` for "tirsdag 3. november" or `"en-GB"` for "Tuesday 3 November". |

```jsonc
["~/pasode-plugins/plugins/clock", { "locale": "en-GB", "seconds": true }]
```

# weather

Today's weather in pasode's sidebar, right under the [clock](../clock): the place with sunrise and sunset, the temperature now, today's high and low, and when it rains.

```
Torød         ☀ 07:44 – 16:18
☁ 7°              ↑ 9°  ↓ 4°
Regn 14–18, 3 mm
```

- **Place line:** the place the forecast is for, with sunrise and sunset on the right. A ⌖ in front, as in "⌖ Tønsberg", means GeoClue found the place. Without the ⌖, it's the place from your config. On days the sun doesn't rise or set, the right side reads **☾ Mørketid** (polar night) or **☀ Midnattssol** (midnight sun).
- **First line:** a weather symbol and the temperature now, with the high and low from now until midnight on the right.
- **Second line:** the hours with rain and the total amount, such as "Regn 09–11, 15–18, 4 mm". A dry day reads **Opphold**. When all of it falls as snow, the line starts with **Snø**.
- **From 21:00:** the sun times, high, low, and rain cover tomorrow, and the right side reads "I morgen: ↑ 9°  ↓ 4°".

The plugin calculates sunrise and sunset itself, within a minute of yr's times. The symbols are ☀ (clear), ☾ (clear night), ☁ (cloudy), ≡ (fog), ☂ (rain or sleet), ❄ (snow), and ϟ (thunder). An hour counts as rainy from 0.1 mm.

Like the rest of the sidebar, the weather shows in chats, not on the home screen. It hides until the first forecast arrives.

## Where the forecast comes from

The plugin gets hourly forecasts from [yr](https://www.yr.no) through MET Norway's free [Locationforecast API](https://api.met.no/weatherapi/locationforecast/2.0/documentation). It fetches a new forecast when the API says the old one has expired, usually every 30 minutes. While the network is down, it keeps showing the last forecast and adds the time it was fetched, such as "☁ 7° (10:30)".

The plugin caches the forecast and the looked-up place in `$XDG_STATE_HOME/pasode/weather.json` (default `~/.local/state/pasode/weather.json`). Several pasode windows share the cache, so they send one request between them.

## Location

By default the forecast is for Oslo. To set your own place, use `place` with a place name, which the plugin looks up once on [OpenStreetMap](https://nominatim.openstreetmap.org), or `lat` and `lon`.

To have the forecast follow the laptop, install GeoClue, Linux's location service. On Arch Linux, install the `geoclue` package. GeoClue finds the laptop from nearby Wi-Fi networks, and the plugin asks it again on every forecast fetch. Without GeoClue, or when it can't tell, the plugin uses the set place. The plugin doesn't guess from your internet address, which usually points to your provider's hub.

The plugin asks GeoClue through its `where-am-i` demo program. If the location never changes from the set place, GeoClue may be refusing the request. To allow it, add this section to `/etc/geoclue/geoclue.conf`, then restart GeoClue:

```ini
[where-am-i]
allowed=true
system=false
users=
```

The plugin rounds the location to about a kilometre before it asks yr. For a GeoClue location, or for `lat` and `lon`, it gets the place name from OpenStreetMap's reverse lookup, once per square kilometre, and caches it.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `place` | `"Oslo"` | The place name to show weather for when GeoClue can't tell. |
| `lat`, `lon` | | Coordinates to use instead of `place`. |
| `follow` | `true` | Uses GeoClue's location when GeoClue is installed. `false` always uses the set place. |
| `locale` | `"nb-NO"` | Norwegian text for `nb`, `nn`, and `no` locales, English for any other, such as `"en-GB"`. Also sets the decimal mark in rain amounts. |

```jsonc
["~/pasode-plugins/plugins/weather", { "place": "Bergen", "locale": "en-GB" }]
```

# Calculator

A four-function calculator, built as a [SACRVM APPKIT](https://github.com/SACRVM/sacrvm-appkit) app:
one custom element, one classic script, no build step.

Digits, decimal point, `+ − × ÷`, percent, sign toggle, backspace and a
two-stage clear key, driven by mouse or keyboard. The small line above the
result shows the pending operation; the big line shows the current entry,
grouped in thousands and shrinking instead of overflowing.

## Run it

```bash
npx serve .        # http://localhost:3000 — then F5 to develop
```

`index.html` is the harness: the app alone, no desktop. It borrows the kit
from `sacrvm.github.io/sacrvm-appkit` — swap those two URLs for a local path
if you keep a copy of the kit.

## Install it on a desktop

Copy the folder next to your shell and register the manifest:

```js
sac.apps.register({
    id:          "calculator",
    name:        "Calculator",
    icon:        "note",
    description: "A four-function calculator with percent, sign toggle and full keyboard support.",
    kind:        "window",
    tag:         "app-calculator",
    src:         "calculator/app.js",
    width:       "320px",
    height:      "500px",
});
sac.apps.init();
```

`app.json` holds the same values — a desktop that reads manifests instead of
hardcoding them can take it from there. The app injects its own `app.css`
relative to `app.js`, so it works from any path.

The tile icon is the kit's `note` glyph; a host with its own icon registry can
`sac.icons.register("calculator", …)` and point the manifest at that instead.

## Keyboard

| Key | Does |
| --- | --- |
| `0`–`9` | Enter a digit |
| `.` `,` | Decimal point |
| `+` `-` `*` `/` | Operators (`x` and `:` work too) |
| `Enter` `=` | Equals — press again to repeat the last operation |
| `%` | Percent |
| `F9` | Toggle sign |
| `Backspace` | Delete the last digit |
| `Delete` | Clear the entry |
| `Escape` | All clear |

The app owns the keyboard while it has focus, and also picks up keys when
nothing else on the page is focused — so it never eats another app's typing.

## Arithmetic

A two-register pocket-calculator machine: an accumulator, one pending
operator, and the entry on screen.

- **Chained operators** fold as you go — `2 + 3 × 4` is `(2 + 3) × 4 = 20`,
  left to right, the way a pocket calculator reads it. Not precedence.
- **Repeated equals** replays the last operation: `2 + 3 =` → `5`, `=` → `8`.
- **Percent** is context-sensitive: after `+` or `−` it is a percentage *of*
  the accumulator (`200 + 10 % =` → `220`); otherwise a plain `/100`.
- **Division by zero** and overflow stop the machine with a message; a digit
  or `AC` starts over.
- **Results carry 12 significant digits** — enough for real work, few enough
  that binary float noise never reaches the display (`0.1 + 0.2` is `0.3`).
  Beyond `1e12` or below `1e-9` the display switches to exponential.

## License

MIT — see [LICENSE](LICENSE).

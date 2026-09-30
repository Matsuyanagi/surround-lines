# Surround Lines

Surround the lines touched by your selection or cursor with configurable header and footer text. Multiple selections are handled together and the complete change can be undone in one step.

## Usage

1. Select one or more lines, or place cursors on the lines to surround.
2. Run **Surround Lines** from the Command Palette.
3. Choose a format from Quick Pick. Press Escape to cancel without editing.

With no command argument, the extension offers every configured format in order. A single configured format is still shown in Quick Pick. You can select a format directly by passing its exact name to `extension.surroundLines`.

The default `comment` format inserts `/*` and `*/` on lines around the selected lines. When a format has `indent` enabled, its nonempty header and footer lines use the indentation of the first nonblank selected source line.

## Settings

This extension contributes `surroundLines.formats`. Each entry needs a unique, nonblank `name`, a string `header`, a string `footer`, and a boolean `indent`.

The default is:

```json
{
  "surroundLines.formats": [
    {
      "name": "comment",
      "header": "/*",
      "footer": "*/",
      "indent": true
    }
  ]
}
```

Setting `surroundLines.formats` replaces the default array. Include `comment` in your array if you want to keep it alongside custom formats:

```json
{
  "surroundLines.formats": [
    {
      "name": "comment",
      "header": "/*",
      "footer": "*/",
      "indent": true
    },
    {
      "name": "region",
      "header": "// #region",
      "footer": "// #endregion",
      "indent": false
    }
  ]
}
```

Header and footer values may be empty or contain multiple lines. An empty value inserts no line on that side. For a multiline value, line endings are converted to match the document; indentation is added to each nonempty configured line when `indent` is enabled. An empty configured line remains empty.

## Keybinding

To bind a key to a specific format, add an entry to your `keybindings.json`. The file is a JSON array:

```json
[
  {
    "key": "ctrl+alt+/",
    "command": "extension.surroundLines",
    "args": {
      "name": "comment"
    },
    "when": "editorTextFocus"
  }
]
```

The `name` must exactly match a configured format. Without `args`, the command opens Quick Pick.

## Multiple selections

Every selection is converted to the full lines it touches. Separate ranges are surrounded independently in one edit, so one Undo restores the original document. If two ranges touch the same line, the command warns and makes no edit.

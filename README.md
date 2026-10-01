# Surround Lines

Surround the lines touched by your selection or cursor with configurable header and footer text. Multiple selections are handled together and the complete change can be undone in one step.

## Usage

1. Select one or more lines, or place cursors on the lines to surround.
2. Run **Surround Lines** from the Command Palette.
3. Choose a format from Quick Pick. Press Escape to cancel without editing.

With no command argument, the extension shows the configured formats whose `languageId` includes the current document language, in configuration order. A single candidate is still shown in Quick Pick. You can select a format directly by passing its exact name to `extension.surroundLines`.

The default `comment` format inserts `/*` and `*/` on lines around the selected lines. When a format has `indent` enabled, its nonempty header and footer lines use the indentation of the first nonblank selected source line.

## Settings

This extension contributes `surroundLines.formats`. Each entry needs a unique, nonblank `name`, a string `header`, a string `footer`, and a boolean `indent`. The optional `languageId` property is an array of language identifiers used to filter Quick Pick candidates:

- Omit `languageId` to show the format for every language.
- Set it to one or more identifiers to show the format only when one exactly matches the document's language ID. Matching is case-sensitive; identifiers are not normalized.
- An empty array keeps the format out of Quick Pick for every language.
- Invalid `languageId` values invalidate the entire formats setting. If valid formats exist but none match the current language, the command shows a warning and does not open Quick Pick.

Language filtering applies only to Quick Pick. A command argument with an exact format name can still select a format whose `languageId` does not match, including a format with an empty array.

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

Setting `surroundLines.formats` replaces the default array. This example defines a C-family format and an unrestricted date format:

```json
{
  "surroundLines.formats": [
    {
      "name": "default",
      "header": "//-- header",
      "footer": "//-- footer",
      "indent": true,
      "languageId": ["c", "cpp", "csharp"]
    },
    {
      "name": "date",
      "header": "[$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE]",
      "footer": "----",
      "indent": true
    }
  ]
}
```

In this example, C, C++, and C# documents show both formats. Other languages show only `date`. The `default` format remains directly selectable by name in any language.

Header and footer values may be empty or contain multiple lines. An empty value inserts no line on that side. For a multiline value, line endings are converted to match the document; indentation is added to each nonempty configured line when `indent` is enabled. An empty configured line remains empty.

### Date variables

Header and footer text can use these date variables:

| Variable | Value |
| --- | --- |
| `$CURRENT_YEAR` | Four digit year, such as `2026` |
| `$CURRENT_MONTH` | Two digit month, `01`–`12` |
| `$CURRENT_DATE` | Two digit day of the month, `01`–`31` |
| `$CURRENT_DAY_NAME_SHORT` | Short weekday name in the VS Code display language, such as `木` or `Thu` |
| `$CURRENT_HOUR` | 24-hour clock hour, `00`–`23` |
| `$CURRENT_MINUTE` | Minute, `00`–`59` |
| `$CURRENT_SECOND` | Second, `00`–`59` |

The command captures one date and time after a format is selected and the document is confirmed unchanged. Header, footer, and every selected range use that same snapshot. Date and time numbers use the local time of the Extension Host. If the extension runs remotely, that means the connected host's time and time zone. The weekday follows VS Code's display language.

Prefix a variable with another `$` to keep it literal: `$$CURRENT_YEAR` inserts `$CURRENT_YEAR`. Unknown variable names are kept as typed. Only the seven names in the table are expanded.

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

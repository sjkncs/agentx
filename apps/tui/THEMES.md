# TUI themes

AgentX separates theme presets from semantic color usage:

- `src/ui/themes/types.ts` defines the semantic token contract.
- `src/ui/themes/presets.ts` contains complete theme presets.
- `src/ui/themes/theme-manager.ts` selects the active preset.
- `src/ui/theme.ts` exposes dynamic semantic accessors to components.

Components should use semantic groups instead of literal colors:

- `inkColors`: compatibility layer for the main canvas, structure, text, and status.
- `selectionColors`: slash completion, session picker, resource picker, and output picker.
- `tuiTheme`: full semantic token tree for new components.

The default preset is `mist-dark`. To switch at startup:

```bash
agentx-tui --theme legacy-dark
AGENTX_TUI_THEME=legacy-dark agentx-tui
```

To add a style, define one complete `TuiThemePreset` in `presets.ts` and append it
to `builtInThemes`. Components consuming semantic tokens do not need to change.

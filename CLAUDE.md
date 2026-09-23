# Notes for AI coding assistants (Claude Code in VS Code)

- Plain HTML/CSS/JS, no build step, no npm dependencies. Do not add a bundler unless asked.
- `public/js/*.js` are classic scripts sharing ONE global scope. Load order is set in `public/index.html`: ai, data, qbank, lab, app, labui, boot. Never call app functions at the top level of a file; startup code belongs in `boot.js`.
- Content lives in `data.js` (lessons, route, plan, exams), `qbank.js` (questions, flashcards), `lab.js` (setup, tours, guides). UI code lives in `app.js` and `labui.js`.
- All clicks go through one delegated handler: add `data-act="name"` to an element and a `name:` handler to the `ACT` object in `app.js`. Inputs use `data-chg` in the `change` listener.
- State is the global `S` (see `freshState()`); call `save()` after changing it. Keep `combine()` and `mergeState()` in sync when adding fields.
- The AI trainer goes through `window.claude.use("sample")`, implemented in `public/js/ai.js`, which calls `/api/chat` (streaming text) and `/api/json`. Server calls live in `lib/ai.js`: Google Gemini (free tier) when `GEMINI_API_KEY` is set, else Anthropic via `ANTHROPIC_API_KEY`. Keys never reach the browser.
- Styling: CSS custom properties on `:root`, with dark-mode overrides in two places (the media query and `[data-theme="dark"]`). Update both.
- Run `npm run check` after edits.

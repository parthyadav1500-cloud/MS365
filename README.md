# Route to D365 Consultant

A mobile-first learning app that takes a complete beginner from zero to the Microsoft **AB-210 (Dynamics 365 Sales AI Consultant)** exam.

- **Learn:** 19 animated lessons with voice narration, arranged as a train-map route, with a checkpoint quiz after every stage. Lessons, tours, guides and mocks open in a Udemy-style course player with a "Course content" sidebar and per-lecture notes.
- **Lab:** 10-step guided trial setup, 6 interactive screen tours with "find it" quizzes, and 17 how-to guides with "show me where" screens.
- **Practice:** drills, flashcards, a Sales Hub simulator, timed mock exams, readiness bars and a glossary.
- **Plan:** an 8-week schedule with exam countdowns.
- **Help:** an AI trainer (free Google Gemini, or Claude) that knows which screen you're on and accepts screenshots.

No build step and no npm dependencies: plain HTML, CSS and JavaScript, plus three Vercel serverless functions.

## Project structure

```
d365-route/
├── public/                 # static site (Vercel serves this folder)
│   ├── index.html          # page shell; loads the scripts in order
│   ├── css/styles.css      # all styles, light and dark themes
│   └── js/
│       ├── ai.js           # browser adapter: connects the Help trainer to /api/*
│       ├── data.js         # lessons, route, exams, 8-week plan      ← edit content here
│       ├── qbank.js        # quiz questions and flashcards           ← edit content here
│       ├── lab.js          # setup steps, screen tours, how-to guides ← edit content here
│       ├── app.js          # core app: state, route map, lessons, drills, mocks, simulator, plan
│       ├── labui.js        # lab screens, screen-mock renderer, help panel, XP
│       └── boot.js         # starts the app (must load last)
├── api/
│   ├── health.js           # GET  /api/health  → is the AI trainer configured?
│   ├── chat.js             # POST /api/chat    → streams the trainer's answer (text + screenshot)
│   └── json.js             # POST /api/json    → JSON replies (practice-question generator)
├── lib/ai.js               # shared server helpers (AI provider, access code, rate limit)
├── scripts/check.mjs       # `npm run check`: syntax check for every file
├── vercel.json             # function timeouts and security headers
├── .env.example            # environment variables to set
└── package.json
```

**Important:** the files in `public/js/` are classic scripts that share one global scope, so the **load order in `index.html` matters**: content files first, then `app.js`, then `labui.js`, then `boot.js`. When you add a new file, add a `<script defer>` tag before `boot.js`.

## Run it locally (VS Code)

1. Install Node.js 18 or newer.
2. Open the folder in VS Code.
3. **Front end only** (no AI trainer):
   ```bash
   npm run preview        # serves public/ at http://localhost:3000
   ```
4. **Everything, including the AI trainer:**
   ```bash
   npm i -g vercel        # once
   cp .env.example .env.local   # then put your free GEMINI_API_KEY in it
   vercel dev             # http://localhost:3000
   ```
5. Before committing, run `npm run check`.

## Deploy to Vercel

1. Push the folder to a new GitHub repository.
2. In Vercel, select **Add New → Project**, import the repository, and keep the defaults (framework preset **Other**, no build command). Vercel serves `public/` and turns `api/` into functions.
3. In **Project → Settings → Environment Variables**, add:

| Variable | Required | What it does |
|---|---|---|
| `GEMINI_API_KEY` | For the trainer (free) | A free key from [Google AI Studio](https://aistudio.google.com/apikey), no card needed. Stays on the server. |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-3.5-flash`. |
| `ANTHROPIC_API_KEY` | Paid alternative | Used only when `GEMINI_API_KEY` is empty. Your key from the Claude Console. |
| `ANTHROPIC_MODEL` | Optional | Defaults to `claude-sonnet-5`. |
| `ACCESS_CODE` | Recommended | A passcode the app asks for once. Stops strangers from using up your quota. |

4. Redeploy. Open the site, tap **Help**, and ask a question.

The Gemini free tier has daily request limits; if they run out, the trainer says the service is busy until the quota resets. Google may use free-tier prompts to improve its products, so don't paste anything private into the trainer.

Without an AI key everything still works except the live trainer. Help then shows the common fixes for the current step and a ready-made question to paste into a Claude chat.

Alternatively, deploy from the terminal: `vercel` for a preview, `vercel --prod` for production.

## Where progress is saved

Progress (lessons, quiz answers, flashcards, guides, tours, setup, plan ticks, mock scores, lecture notes) is saved in the browser's `localStorage` under the key `d365route.v1`. **Plan → Settings → Export / Import** makes a JSON backup, for example to move between phone and laptop.

## Editing content

- **Add a lesson:** add an object to `LESSONS` in `data.js`, add its id to `ROUTE`, and add questions with `l: "<id>"` in `qbank.js`. Scene types: `flow`, `split`, `tree`, `grid`, `tiles`, `levels`, `chat`, `bpf`, `funnel`, `layers` (renderers in `renderScene()` in `app.js`).
- **Add a quiz question:** add to `QUESTIONS` in `qbank.js`. Put the correct answer's index in `a`; options are shuffled when shown.
- **Add a how-to guide:** add to `GUIDES` in `lab.js`. A step's `see: ["T3", "qualify"]` shows tour T3 with region `qualify` outlined.
- **Add a screen tour:** add to `TOURS` in `lab.js`. Regions use a 100 × 120 grid (x, y, w, h). Region types: `bar`, `nav`, `icons`, `cmd`, `btn`, `input`, `title`, `text`, `header`, `bpf`, `tabs`, `fields`, `timeline`, `chart`, `list`, `panel`, `grid`.
- **Change the trainer's behaviour:** edit `coachRules()` in `labui.js`.

Microsoft changes Dynamics 365 screens, exams and agent features often. Re-check the AB-210 study guide and the tour drawings every few months.

## Enhancement ideas

- **Sync across devices:** add sign-in and a small database (for example Supabase or Vercel KV) and replace the `localStorage` save in `save()` / `loadLocal()`.
- **Installable app (PWA):** add a `manifest.json` and a service worker for offline lessons.
- **Real screenshots in tours:** swap the drawn mocks for annotated screenshots of your own trial.
- **Customer Service line (MB-230):** add lessons, questions and guides using the same data shapes.
- **Move to a framework later:** if the codebase grows, migrate to Vite with ES modules. Convert the shared globals into imports first.

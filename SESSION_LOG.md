# Session Log

Chronological record of what happened in each build session, kept alongside
`DECISIONS.md` (why) and `BUILD_CHECKLIST.md` (what's left). This log is the
"what actually happened, including the detours" — useful when picking the
project back up cold.

## 2026-09-18 — Planning + Session 1 (Skeleton + Orb)

**Planning:**
- Reviewed the existing docs (README, ARCHITECTURE, DECISIONS, BUILD_CHECKLIST)
  and confirmed the project was still at Phase 0, no code written.
- Considered [Wispr Flow](https://wisprflow.ai) as a possible STT tool —
  ruled out: no public API (confirmed via their site, a 404 on `/api`, and a
  pricing page with only per-seat subscriptions, no usage-based API tier),
  and even hypothetically it's tuned for long-form dictation cleanup, not
  short command transcription. Web Speech API (already the plan) stays.
- Built an end-of-month build plan (see the approved plan, now superseded by
  this log + BUILD_CHECKLIST.md progress) — 4 sessions mapped to
  BUILD_CHECKLIST.md's 8 phases, sized for a 5–10 hrs/week pace over the
  ~12 days remaining in the month.
- Two scope adjustments from what the original docs assumed:
  - **Build machine:** DECISIONS.md #6 called for Mac-first. Actually built
    on Windows instead, since that's where the working session was. TTS
    will use SAPI, not `say`; app-launch config (Phase 7) will be
    Windows-only for now. Mac port stays a deferred task.
  - **Timeline:** "end of month" turned out to be 12 days out, not the
    ~2.5 weeks assumed when scoping — plan compressed accordingly, with the
    core silent voice loop (Phase 6) as the hard checkpoint before the 3
    tools (Phase 7) and orb wiring (Phase 8), which are the stretch goals.

**Session 1 — Skeleton + Orb (BUILD_CHECKLIST.md Phases 1–2):**
- Scaffolded the Electron project: `npm init`, installed `electron` as a
  dev dependency.
- Built the transparent, always-on-top, frameless window (`main.js`).
- Built the orb: an animated SVG with a radial-gradient glow and CSS
  keyframe rotation (`index.html`, `orb.css`), 4 dev-switchable states
  (idle/listening/thinking/done) via on-screen buttons or keys 1–4
  (`orb.js`).
- Added a close (×) button and window dragging, since the frameless window
  had no way to move or quit it otherwise.
  - **Bug hit:** the × button silently did nothing on click, no console
    errors. Root cause: `-webkit-app-region: drag` on `<body>` (used so the
    orb could be dragged) was swallowing the click — a known Chromium/
    Electron quirk where `no-drag` hit-test regions on small elements
    aren't always honored, and (worse) sometimes only get recalculated
    after some other repaint happens. Confirmed via an Escape-key IPC
    fallback that worked immediately, isolating the issue to the CSS
    drag-region hit-testing specifically, not the IPC/preload plumbing.
  - **Fix:** dropped `-webkit-app-region` entirely and replaced it with
    plain JS mouse tracking (`mousedown`/`mousemove` on the orb) sent over
    IPC to `main.js`, which repositions the window with
    `BrowserWindow.setPosition()`. Deterministic, no hit-test caching
    involved — both drag and the close button work reliably now.
- Added `start-saarathi.vbs` — a double-clickable launcher that runs
  `npm start` with no visible console window, for convenience over typing
  `npm start` in a terminal each time.
- Installed `@anthropic-ai/sdk` and `dotenv` in preparation for Session 2
  (Claude API calls + loading the API key from a local, gitignored `.env`
  file — user will add the key manually, not via chat).
- Verified end to end: window renders, orb glows/rotates, all 4 states
  switch correctly, dragging works, close button works standalone (no
  longer needs the state buttons clicked first to "unstick" it).

**Checkpoint reached:** BUILD_CHECKLIST.md Phases 1–2 complete.

**Next session:** Session 2 — global push-to-talk hotkey (tap-to-toggle,
not true hold-to-talk — Electron's `globalShortcut` has no key-up event;
`uiohook-napi` would be needed for real hold-to-talk, deferred for now),
Web Speech API capture, a plain-text Claude API call, and SAPI
text-to-speech (BUILD_CHECKLIST.md Phases 3–6).

## 2026-09-20 — Session 2 (Hotkey + voice loop)

**Built (BUILD_CHECKLIST.md Phases 3–6):**
- Global hotkey `Control+Shift+F9` via `globalShortcut`, tap-to-toggle
  (tap to start listening, tap again to stop).
- Mic capture in the renderer, mic-only permission handler in `main.js`.
- Claude call from the main process via the Anthropic SDK (plain text, no
  tools yet). Default model `claude-haiku-4-5-20251001`, override with
  `SAARATHI_MODEL`. `ANTHROPIC_API_KEY` loaded from a gitignored `.env`.
- Windows SAPI TTS: PowerShell spawned with fixed args, reply text passed on
  stdin (never in the command string).
- Orb states now driven by the real pipeline (listening / thinking / done /
  idle) instead of only the dev buttons.

**Detour — Web Speech API failed:** `speech error: network` on first test
(stock Electron has no Google API keys). Per the plan, switched to the
documented fallback instead of debugging: local **whisper.cpp**
(`whisper-bin-x64` build b5130, `ggml-base.en` model) in a gitignored
`vendor/whisper/` folder. The renderer records 16 kHz mono PCM and encodes a
WAV; main writes a temp file, runs `whisper-cli.exe` via `spawn` with an
args array, and deletes the file. Transcription takes about 2-3 s. No key,
no cost, audio stays local. `vendor/` must be re-downloaded on a fresh
clone (not in git).

**Verified:** hotkey -> speak -> transcript -> Claude reply, twice in a row,
no errors in the terminal. Spoken reply confirmed audible on the speakers.

**Housekeeping:** fixed stale `docs/` paths in README.md (docs live at the
repo root); updated the checklist, including Phase 0.

**Next:** Session 3 — the 3 tools (BUILD_CHECKLIST.md Phase 7): tool
schema, per-machine app-name config (Windows), `open_website`, `open_app`,
`search_web`. Possible small extra: auto-stop after ~1.5 s of silence so the
hotkey needs one press instead of two.

**Open item — more testing needed:** on the second test run the orb's
automatic stage switching may not have happened, but the tester was rushing
and can't confirm whether the second hotkey press was made. Do ~4 more
careful runs (press once, speak, press again, wait) and note whether the
orb goes thinking -> done -> idle by itself each time. If it doesn't, debug
before Session 3.

**Update:** three further test runs — orb went to thinking and the reply was
spoken each time. Added conversation history: each exchange is appended as
one JSON line (time, you, claude/error) to `logs/history.jsonl` (gitignored,
local only).

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
  the removed `SAARATHI_MODEL` override. `ANTHROPIC_API_KEY` loaded from a gitignored `.env`.
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

## 2026-09-20 — Session 3 (the 3 tools) + cost tracking

- `tools.js`: tool schema plus executors for `open_website`, `open_app`,
  `search_web`. `open_website` accepts only http/https URLs with a dotted
  hostname and opens via Electron's `shell.openExternal`; `search_web` opens
  a Google results page; `open_app` looks the name up in `apps.json` and
  launches via `cmd /c start` with the target passed as an argument. Claude's
  output never reaches a command string. Unknown tools/apps are refused.
- `main.js`: sends the tool schema with each request; runs up to 3 tool
  calls; speaks the executor's result (see `DECISIONS.md` #11).
- Cost tracking: each exchange prints `[usage] in X / out Y tokens = $Z
  (session total)` and stores tokens + `cost_usd` + model in
  `logs/history.jsonl`. Haiku 4.5 pricing: $1 / $5 per million tokens; about
  $0.001 per exchange with the tool schema attached.
- Headless test (no mic): refusal paths (`javascript:`, `file:`, bare
  hostnames, injection-style app names, unknown tools) all refused with
  nothing launched; Claude chose the right tool for "open youtube", "open the
  calculator", "search for ..." and declined "delete my documents folder".
- **Verified by voice (2026-09-20):** all three tools launch correctly by
  speaking, and `[usage]` cost lines show in the terminal. BUILD_CHECKLIST
  Phase 7 complete.
- Model fixed to Haiku 4.5 (`DECISIONS.md` #13).
- Wake phrase requested. Picovoice Porcupine now requires commercial-use
  approval for a key, so it's out. Leading option: whisper-gated wake phrase
  (transcribe speech locally, act when the text contains "Saarathi"), built
  after silence auto-stop. Awaiting go-ahead.

## 2026-09-20 — Silence auto-stop + wake phrase (whisper-gated)

- `orb.js` rewritten around one always-on mic pipeline with energy-based
  voice detection: utterances end after ~1 s of silence, so the hotkey needs
  one press (a second press still ends early). Deaf while thinking/speaking
  plus an 0.8 s cooldown so it can't hear its own voice.
- `wake.js`: fuzzy wake-word matcher. Tested against whisper's real output
  for a synthetic voice ("Sautarathai", "Sarti", "Sāgāratha") and against
  look-alikes ("Sarah", "Karthi", "Saturday", "Sorry"...). Known edge:
  "Sara the dog" matches.
- `main.js`: audio arrives with a mode (wake / hotkey / followup); ambient
  speech without the name is dropped unlogged. `Ctrl+Shift+F8` toggles wake
  listening and closes the mic.
- Smoke-tested: app starts, mic opens, no errors.
- **Verified with a real voice (2026-09-20):** "Saarathi, open the calculator"
  in one breath works; "Saarathi" then a command a few seconds later works;
  hotkey + "open notepad" ends on silence; normal talk without the name does
  nothing. Still to confirm: `Ctrl+Shift+F8` toggle (mic icon in tray) and a
  longer soak for false triggers from TV/calls.

## 2026-09-20 — Wake phrase tuning from calibration data

- User reported the wake phrase worked only sometimes. Added a calibration
  mode (`SAARATHI_CALIBRATE=1` logs every ambient utterance's whisper text,
  MATCH / no, to the terminal and `logs/calibration.txt`) and a green/grey
  dot in the orb's corner showing wake listening on/off.
- Calibration findings (base.en, user's voice): the name came out as
  Saradi / Sara di / Sāradi (matched) but also Saturday (x4), Saudi, Sadehi,
  Sari, Sada dee, Saredi (missed). Command text was sometimes misheard too
  ("beauty of", "chargey beauty app" for ChatGPT).
- **Bug found:** utterances spoken while whisper was still transcribing the
  previous one (~2-3 s) were discarded — likely a main cause of "sometimes
  works, sometimes doesn't". Fixed with a queue (`pendingWake`, newest 2
  kept); still dropped while Saarathi is answering so it can't hear itself.
- `wake.js`: added an alias list of the observed spellings, honoured only
  in the first two words; the fuzzy rule now looks at the first three words
  (was six). Verified offline: all 16 observed name utterances match, 16
  ambient/look-alike sentences are rejected. Accepted trade-off: a sentence
  starting with "Saturday"/"Sari" wakes it (cost: one cheap Claude call;
  only the 3 safe tools are reachable).
- Open option: `small.en` whisper model (~470 MB) for better accuracy on
  commands, at ~2-3x transcription time. Not changed; user to decide.

**Re-test results (calibration mode, 4 exchanges, $0.0048):**
- Wake: 4 of 4 name attempts matched (all heard as "Saturday" / "Hey,
  Saturday" — the alias list was the right fix). Ambient talk and a 15 s
  monologue produced no action.
- Tools by wake phrase: calculator, weather search and YouTube all worked.
- Command text from whisper base.en was sometimes garbled ("for weather in
  Bangalore. Hey, that's for weather in Bangalore", "Where is Shana
  Channel? Open.") though Claude still chose sensible tools.
- **Bug found:** saying the name and the command back-to-back sent the
  command to the ambient path (queued while the name was still being
  transcribed) and it was dropped, so the user had to repeat it. Fixed:
  after the name is heard alone, the next utterance within 8 s is the
  command even if it was captured as ambient (`followupDeadline` in
  `main.js`, renderer told to cancel its follow-up arm).

**small.en added (two-stage STT):** downloaded `ggml-small.en.bin` (488 MB,
Hugging Face) into `vendor/whisper/`. Benchmarked: base.en ~2 s, small.en
~6 s, threads don't help. Implemented base-for-screening, small-for-commands
(`DECISIONS.md` #15); each small.en run logs `[stt] small.en N.Ns` in the
terminal. `logs/calibration.txt` deleted at the user's request after tuning.

**Latency cut:** user found the ~8 s one-breath wait too slow. Benchmarked
options: extra threads (no gain), greedy decoding (no gain), flash attention
(small gain), and shrinking whisper's audio window with `-ac` to the clip's
real length (2x). Implemented `-fa` + dynamic `-ac` in `transcribe()`
(`DECISIONS.md` #15a): base ~1.0 s, small ~2.6 s for a typical 3 s command,
identical transcripts on test clips. Rigorous voice testing by the user next.

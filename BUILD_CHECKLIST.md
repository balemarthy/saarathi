# Build Checklist

Work through this top to bottom. Check a box, then move to the next — don't
jump ahead. See `ARCHITECTURE.md` for what each piece is, and `DECISIONS.md`
for why it's built this way.

## Phase 0 — Accounts & keys
- [x] Anthropic Console account — already existed from a prior project
- [ ] Add billing / buy credits — in progress
- [ ] Generate a fresh, dedicated API key named "saarathi" (do not reuse
      existing keys from other projects — one key per project keeps cost and
      blast radius isolated)

## Phase 1 — Project skeleton
- [ ] Install Node.js (Mac — see `DECISIONS.md` #6 on why Mac is the build
      machine)
- [ ] Create an empty Electron project
- [ ] Get a blank transparent, always-on-top window showing on screen —
      nothing else yet

## Phase 2 — The orb (visual only, no logic behind it)
- [ ] Draw a static circle/orb in the window
- [ ] Add a glow effect to it
- [ ] Add a rotation animation
- [ ] Add 4 distinct visual states — idle / listening / thinking / done —
      switchable by hand for now (no real trigger wired in yet)

## Phase 3 — Hotkey
- [ ] Register a global push-to-talk hotkey
- [ ] Pressing it switches the orb to "listening" state — visual only, mic
      still not wired

## Phase 4 — Speech-to-text loop
- [ ] While hotkey is held, capture mic audio via Web Speech API
- [ ] Transcribe speech to text and print it on screen or console — confirm
      it's accurate before moving on

## Phase 5 — Talk to Claude (plain text, no tools yet)
- [ ] Send the transcribed text to Claude API as a normal message, no tool
      schema attached
- [ ] Print Claude's text reply to console — confirm the API connection
      actually works

## Phase 6 — Text-to-speech loop
- [ ] Take Claude's text reply and speak it aloud via OS-native TTS
- [ ] Confirm the full silent loop end to end: press hotkey → talk → hear
      Claude's answer spoken back. No real actions yet — this just proves
      the pipe works.

## Phase 7 — Add the 3 safe tools, one at a time
- [ ] Attach the 3-tool schema to the Claude API call
- [ ] Build the app-name-to-launch-command JSON config for this machine (Mac)
- [ ] Implement `open_website` executor — test with a spoken command
- [ ] Implement `open_app` executor — test with a spoken command
- [ ] Implement `search_web` executor — test with a spoken command

## Phase 8 — Wire the orb to the real loop
- [ ] Connect orb states to actual pipeline stages: listening while
      recording, thinking while waiting on Claude, done when the action
      fires — replacing the manual switching from Phase 2

## Later (deliberately deferred, not v1)
- Wake-word always-listening mode (Picovoice/Porcupine) — see `DECISIONS.md`
  #3
- Port to Windows laptop — see `DECISIONS.md` #6
- Higher-quality TTS (ElevenLabs/OpenAI) if native voice quality bothers you
- Native voice model (OpenAI Realtime / Gemini Live) if the local
  STT→Claude→TTS loop feels too slow once it's actually working — see
  `DECISIONS.md` #4

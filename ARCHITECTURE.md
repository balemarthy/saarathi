# Architecture

## What this is
A transparent, always-on-top desktop orb (Electron) that you talk to via a
push-to-talk hotkey. It performs a small, fixed set of safe actions by having
Claude decide which one to call, based on what you said.

## Non-goals (do not expand without a fresh scoping conversation)
- No computer-use / screenshot-vision / simulated mouse or keyboard input
- No file deletion, editing, or any destructive action
- No sending messages, emails, or submitting forms on Vamsi's behalf
- No always-on wake-word listening in v1 (push-to-talk only — see
  `DECISIONS.md` #3)
- No routing a single voice loop across multiple LLM providers (see
  `DECISIONS.md` #4)

## Interaction loop
1. Push-to-talk hotkey summons the orb and starts listening
2. Web Speech API transcribes speech to text, locally
3. Text goes to Claude API with a fixed 3-tool schema (below)
4. Claude returns which tool to call, with parameters — it never touches the
   screen or takes any action itself
5. The app executes the tool via a whitelisted local command — nothing
   outside this whitelist is ever run
6. A short spoken confirmation plays via OS-native TTS
7. Orb animation reflects state: idle (soft glow) → listening (pulse) →
   thinking (fast rotate) → done (flash, back to idle)

## Tool schema (Claude function calling)
- `open_website(url: string)` — opens default browser to the URL
- `open_app(app_name: string)` — launches a locally installed app
- `search_web(query: string)` — runs a web search and speaks back a short
  summary (Claude performs the search and summarizing itself; the app just
  displays/speaks the result)

## App name → launch command mapping
Local JSON config, one per machine (see `DECISIONS.md` #6 on why this is
per-device), e.g.:
```json
{
  "figma": { "mac": "open -a Figma", "win": "start figma" },
  "notion": { "mac": "open -a Notion", "win": "start notion" }
}
```
Claude only ever sees the friendly name ("Figma"); the app resolves the
actual launch command locally.

## Stack
- **Shell:** Electron — transparent, always-on-top window, global hotkey
- **Orb:** SVG or Canvas, CSS/WebGL glow + rotation, driven by loop state
- **STT:** Web Speech API (Chromium built-in) → upgrade path: Whisper API
- **Brain:** Claude API, tool use, fixed 3-tool schema above
- **Execution:** `child_process.exec()` calling only whitelisted commands —
  nothing else is ever run
- **TTS:** OS-native (`say` / SAPI) → upgrade path: ElevenLabs or OpenAI TTS

## Billing
Requires a separate Anthropic Console/API account with pay-as-you-go
credits — distinct from a Claude Pro subscription, which does not include
API usage.

# Decisions Log

Chronological record of the calls made on this project and why, so nobody
re-litigates a settled question by accident.

## 1. Scope: no full computer control
Original idea was inspired by Iron Man's Jarvis — an agent that could fully
browse and operate the computer — click, type, take actions autonomously.
Rejected as v1 scope:
that's a computer-use agent (screenshot → vision model → simulated mouse/
keyboard), which is slow, unreliable even for well-funded teams, and
genuinely risky — a hallucinated action with no undo could delete a file or
submit a form.

**Decision:** v1 only does non-destructive, easily-reversible actions: opening
a website, opening an installed app, running a web search. No screen reading,
no simulated clicks or keystrokes, no destructive actions of any kind. See
"Non-goals" in `ARCHITECTURE.md`.

## 2. Voice is mandatory, not optional
A typed-command launcher isn't Saarathi — talking to it is the entire point.

**Decision:** Full voice loop — speech in, speech out — not a text box.

## 3. Push-to-talk over wake-word for v1
Always-on wake-word listening ("Hey Saarathi") is the more magical feel, but
it's a separate, nontrivial piece of engineering — a local wake-word engine
needs to run continuously without streaming audio to the cloud 24/7.

**Decision:** Push-to-talk hotkey for v1 — ships faster, proves the loop
works. Wake-word is a deliberate v2, via something like Picovoice/Porcupine,
once the core loop is solid.

## 4. LLM brain: Claude API only
Vamsi holds three paid consumer subscriptions — Claude Pro, Gemini's paid
tier (~Rs 300/month), and ChatGPT Go (~Rs 333/month). None of these include
API access; consumer chat subscriptions and API/Console access are billed
separately by all three providers. Building this widget requires a separate
API account regardless of which brain is chosen.

Three real options were compared:
- **Claude API** — text-only, no native audio in or out. Requires an external
  speech-to-text and text-to-speech step around it.
- **OpenAI Realtime (GPT-Realtime-2)** — native speech-to-speech, handles
  interruption/barge-in naturally, tool calling built in. Priced in audio
  tokens; realistic cost lands roughly $0.05–$0.30/minute of conversation.
- **Gemini Live API** — also native speech-to-speech with tool calling,
  priced noticeably cheaper per token than OpenAI's equivalent.

**Decision:** Claude API as the sole brain, with speech-to-text and
text-to-speech handled locally on-device (see #5). Cheapest and simplest
option for this narrow scope (open app / open website / search — doesn't
need deep reasoning), and avoids routing one live voice loop across three
different model providers, which adds sync complexity for no real benefit.
If the resulting loop ever feels genuinely too slow or clunky once it's
working, OpenAI's or Gemini's native voice APIs are the fallback — not
before then.

## 5. Speech-to-text and text-to-speech: local, not cloud
**Decision:**
- STT: Web Speech API — built into Electron/Chromium, free, local. Upgrade
  path to Whisper API if accuracy becomes an issue.
- TTS: OS-native voice — `say` on macOS, SAPI on Windows — free, local, zero
  extra latency. Upgrade path to ElevenLabs or OpenAI TTS later if voice
  quality matters enough to justify the cost and latency.

## 6. Primary build & run machine: Mac, not desktop
Vamsi uses a Mac, a Windows desktop, and a Windows laptop daily, and is
building toward a broader multi-device "second brain" system spanning Azure
and individual drives, with each workstation designated for a specific role.

For this specific widget, that philosophy doesn't require solving
multi-device now — the app-launch commands in `open_app` (Phase 7) are
inherently OS-specific (`open -a Figma` on Mac vs. a different string on
Windows), so there was never going to be one identical widget running
unmodified across all three machines. Each machine needs its own copy with
its own local app-mapping config.

**Decision:** Build and prove v1 fully on the Mac first — it's Vamsi's daily
driver, and macOS's built-in `say` command makes the TTS step simpler there
than on Windows (which needs SAPI). Port to the Windows laptop later, as a
small, bounded task (swap app-launch commands, swap TTS call) — do not
design for multi-device upfront.

## 7. Name: Saarathi
Working name was "Jarvis" — borrowed from the Iron Man franchise, no real
connection to Vamsi's own identity or brands. Vamsi wanted a name rooted in
Sanskrit and Bharatiyata instead.

**Decision:** Saarathi (सारथी) — the charioteer, Krishna's role for Arjuna in
the Gita: the one who takes direction and drives things forward. Fits the
core interaction directly — you say it, it acts — better than a borrowed
name would.

## 8. Move to Claude Code for implementation
This decision-tracking conversation stays for architecture calls and
sequencing. Actual implementation (Node install, Electron scaffolding,
writing the orb, wiring the hotkey, calling the API, debugging) moves to
Claude Code, which can execute commands and edit files directly rather than
being guided through in chat.

## 9. Speech-to-text: whisper.cpp, not Web Speech API (supersedes #5 for STT)
Web Speech API failed in Electron on Windows (`speech error: network` —
stock Chromium has no Google API keys). Switched to local whisper.cpp with
the `ggml-base.en` model: free, no key, audio stays on the machine, ~2-3 s
per short command. TTS stays OS-native (SAPI). The binary and model live in
a gitignored `vendor/whisper/` folder.

## 10. search_web opens browser results (deviates from ARCHITECTURE.md)
ARCHITECTURE.md described `search_web` as Claude searching and speaking a
summary. That needs Anthropic's server-side web search tool (extra per-search
cost, must be enabled for the org). For v1 `search_web` instead opens the
default browser on a Google results page and speaks a confirmation. Upgrade
path if a spoken summary is wanted: add the web search server tool.

## 11. Tool confirmations are spoken from the executor, not a second Claude call
When Claude calls a tool, the app speaks the executor's own result ("Opening
youtube.com.") rather than sending the result back for a second model call.
Saves a round trip of latency and cost, and the spoken text can never
contradict what actually happened.

## 12. Cost visibility
Each exchange logs input/output tokens and USD cost (from a small per-model
price table in `main.js`) to the terminal and `logs/history.jsonl`. Only
Claude costs money; whisper and SAPI are local and free.

## 13. Model fixed to Claude Haiku 4.5
The model is hardcoded (`claude-haiku-4-5-20251001` in `main.js`), with no
environment override. Cheapest and fastest option, and enough for a
three-tool command assistant. Change it in code only if the loop ever proves
too dumb.

## 14. Wake phrase added, whisper-gated (revises #3)
Wake-word listening was deferred in #3. Requested after the core loop worked.
Picovoice Porcupine was ruled out: it now requires commercial-use approval
for an access key. Chosen instead: energy-based voice detection cuts the mic
into utterances; each is transcribed locally by whisper.cpp; the app acts
only if the text starts with "Saarathi" (fuzzy match in `wake.js`, since
whisper spells the name many ways) and drops everything else without logging
it. "Saarathi, open YouTube" works in one breath; "Saarathi." alone starts a
follow-up listen. The hotkey (`Ctrl+Shift+F9`) still works and now ends on
silence too; `Ctrl+Shift+F8` turns wake listening off (closing the mic).
Costs: the mic is open while wake listening is on, and any nearby speech
triggers a ~2 s local whisper run. No audio leaves the machine; only the
command after the name goes to Claude. Deaf while thinking/speaking so it
doesn't hear itself.

# Saarathi

A glowing, rotating desktop orb you talk to. Push a hotkey, speak a command, it
opens the app, website, or search you asked for — voice in, voice out, nothing
riskier than that in v1.

## Status
Currently at **Phase 0 — Accounts & keys** (see `docs/BUILD_CHECKLIST.md`).
Anthropic Console account already existed from a prior project. Billing/credits
in progress. Dedicated API key for this project not yet created — waiting on
credits to land first.

## Start here
- `docs/DECISIONS.md` — why this project is scoped the way it is, and why each
  technical choice was made. Read this before changing any architecture call.
- `docs/ARCHITECTURE.md` — the stack, the tool schema, the safety boundary.
  Read this before writing code.
- `docs/BUILD_CHECKLIST.md` — the actual phase-by-phase build sequence. Work
  through it top to bottom, one checkbox at a time. Don't skip ahead.

## If you're Claude Code picking this up fresh
Read all three docs above in order before touching any code. The scope is
deliberately narrow — do not expand the tool list or add computer-use/vision
capabilities without a fresh conversation with Vamsi about it first. See
"Non-goals" in `docs/ARCHITECTURE.md`.

Primary build machine: Mac (Vamsi's daily driver). Do not design for
multi-device from the start — see `docs/DECISIONS.md` for why.

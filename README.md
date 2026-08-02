# opencode-observer

Give a text-only OpenCode model the ability to "see" images, by routing every
image through a real multimodal sub-agent (`@observer`) and handing the main
model back a text description instead.

Useful when your primary coding model (e.g. DeepSeek-V4, GLM) has no vision,
but you have a multimodal model configured under another provider (e.g.
`mimo-v2.5`, `kimi-k2.6`, `qwen3.7-plus-vl`, ...).

## How it works

- A plugin hook (`experimental.chat.system.transform`) checks whether the
  active chat model can actually see images. If it can't, it appends a short
  instruction telling the model to delegate to `@observer`.
- Another hook (`chat.message`) intercepts image attachments in the incoming
  message. For non-multimodal models it saves the image to a temp file and
  replaces it with a `[Image saved to: <path>]` marker. **Multimodal models
  are left untouched** — their images are never stripped, since they don't
  need the workaround.
- The `observer` sub-agent (pinned to a real multimodal model) is called with
  the file path, reads the image with the built-in `read` tool, and returns a
  structured text description — error-log transcription, chart data
  extraction, marked-issue diagnosis, pixel-level page description for
  HTML/CSS reproduction, or general OCR, depending on what was asked.

This mirrors the workflow described in [DeepSeek-V4 Can't Read Images? I Made
It Read](https://dataleadsfuture.com), adapted to use `mimo-v2.5` as the
reader model.

## Requirements

- [OpenCode](https://opencode.ai) with a provider that has a genuinely
  multimodal model configured (check `attachment: true` and
  `input.image: true`/similar in `opencode models <provider>`).
- Edit `agent/observer.md`'s `model:` frontmatter field to point at that
  model (`provider/model-id`). It defaults to `opencode-go/mimo-v2.5`.

## Install

Auto-discovery: OpenCode scans `plugin/` (or `plugins/`) and `agent/` (or
`agents/`) directories directly under its config root — `~/.config/opencode/`
globally, or `.opencode/` per-project.

```bash
git clone https://github.com/Nneji123/opencode-observer.git ~/.local/share/opencode-observer

mkdir -p ~/.config/opencode/plugin ~/.config/opencode/agent
ln -sf ~/.local/share/opencode-observer/plugin/observer.ts ~/.config/opencode/plugin/observer.ts
ln -sf ~/.local/share/opencode-observer/agent/observer.md   ~/.config/opencode/agent/observer.md
```

Restart OpenCode (or start a new session). Then edit
`~/.config/opencode/agent/observer.md` and set `model:` to a multimodal model
you actually have configured.

To install per-project instead of globally, symlink into `.opencode/plugin/`
and `.opencode/agent/` at the project root instead of `~/.config/opencode/`.

### Uninstall

```bash
rm ~/.config/opencode/plugin/observer.ts ~/.config/opencode/agent/observer.md
rm -rf ~/.local/share/opencode-observer
```

## Known issues

- **OpenCode Desktop may not honor the `observer` agent's configured
  `model:`.** Confirmed via `opencode export <sessionID>`: when `@observer`
  is dispatched through the `task` tool from an OpenCode Desktop session, the
  sub-session's `model` sometimes matches the *parent* session's model
  instead of the one set in `agent/observer.md`, so the sub-agent inherits a
  non-vision model and can't actually read the image. The exact same
  scenario (same config, same multi-turn flow, same `-m` override) was
  reproduced repeatedly and correctly via the `opencode` CLI, where the
  sub-agent's own `model:` is always respected — this points to the bug
  being in Desktop's `task`-dispatch path, not in this plugin/agent config.
  If you hit "this model does not support image input" from `@observer`
  itself, try the same prompt via `opencode` (CLI/TUI) to confirm, and check
  for an OpenCode Desktop update.

## Notes

- Saved images are written to `$TMPDIR/opencode-observer/<sessionID>/` and
  are not cleaned up automatically — they're plain temp files, safe to purge
  periodically.
- The `observer` agent has `edit`, `write`, and `bash` denied — it can only
  read files and report back.

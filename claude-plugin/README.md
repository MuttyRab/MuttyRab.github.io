# GUI Hub plugin for Claude Code

Local file jobs for Claude Code: watch videos (screenshots + transcript), transcribe, make Shorts and audiograms with captions, cut pauses and edit video by transcript, voiceovers, fill PDF forms, convert and compress video, PDFs, images and documents — official open-source engines on your machine.

Install:

```
/plugin marketplace add https://guihub.cc/.claude-plugin/marketplace.json
/plugin install gui-hub@gui-hub
```

The plugin starts the GUI Hub MCP server (`npx -y https://guihub.cc/mcp.tgz`, Node.js 18+). Each job runs an official open-source program (FFmpeg, Whisper, Pandoc, pdfcpu, …) on your computer; files are not uploaded. The first use of a job downloads its program and model once.

Pricing: every tool works 3 times free; a one-time license unlocks unlimited use (https://guihub.cc). Ask Claude to run `gui_hub_status` to see free uses left.

This is an unofficial wrapper: the open-source projects are credited, with their licenses, on https://guihub.cc.

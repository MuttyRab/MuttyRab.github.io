# GUI Hub — desktop GUI + MCP server for croc, F2, FFmpeg, immich-go, Pandoc, pdfcpu

**Website and downloads:** https://muttyrab.github.io

GUI Hub is a desktop app for **Windows, macOS and Linux** that gives well-known open-source command-line tools simple point-and-click forms — and exposes them as an **MCP (Model Context Protocol) server**, so Claude Desktop, Cursor, VS Code, Windsurf and other AI assistants can run them **locally**.

- No Node, Python or API keys to set up: one installer.
- One click in the app (**Use with AI**) connects Claude Desktop or Cursor.
- Runs the official, pinned, SHA-256-verified release of each tool.
- Files never leave your computer.

## MCP tools (19)

| Tool | What it does |
|---|---|
| `croc_receive` | Receive files sent with croc: give the code phrase from the sender and a destination folder. Existing files are kept (renamed) unless existing="overwrite". |
| `f2_rename` | Bulk-rename files in a folder by find & replace (regex unless literal=true; variables like {%03d} counter and {ext}). Without apply=true it is a dry run that returns the old→new table — show it to the user before applying. |
| `f2_undo` | Undo the most recent rename that was applied in this folder. |
| `ffmpeg_compress` | Make a video much smaller (or turn any video into a widely playable MP4). Lower quality and smaller size = smaller file. |
| `ffmpeg_audio` | Save just the sound of a video as an MP3 — for music, lectures or podcasts. |
| `ffmpeg_audio_convert` | Convert an audio or video file's sound to mp3, m4a, wav or flac. normalize=true applies EBU R128 loudness normalization (loudnorm) — good for voice recordings and podcasts. |
| `ffmpeg_gif` | Turn a short part of a video into a good-looking animated GIF. |
| `ffmpeg_trim` | Cut out a part of a video instantly, without re-encoding (no quality loss). Cuts snap to the nearest keyframe. |
| `immich_go_from_google_photos` | Import Google Photos Takeout .zip files into an Immich server (keeps albums, dates, GPS). dryRun defaults to true: run it first and report the summary before uploading for real. |
| `immich_go_from_folder` | Upload every photo and video in a folder and its subfolders. |
| `pandoc_convert` | Convert documents between formats with Pandoc (input format is detected from the file extension: .docx .md .html .epub .odt .rtf .txt .tex). Several inputs are concatenated in order. Use to='gfm' to turn Word/HTML into Markdown for reading or editing. |
| `pdfcpu_merge` | Combine several PDFs into one, in the order listed. |
| `pdfcpu_split` | Split a PDF into smaller files. |
| `pdfcpu_optimize` | Shrink a PDF by removing duplicate and unused data. Text and images stay the same quality. |
| `pdfcpu_rotate` | Rotate all pages or a range of pages. |
| `pdfcpu_watermark` | Stamp text such as DRAFT or CONFIDENTIAL across every page. |
| `pdfcpu_encrypt` | Protect a PDF with AES-256 encryption. |
| `pdfcpu_decrypt` | Remove the password from a PDF you have the password for. |
| `pdfcpu_extract_pages` | Save selected pages as separate PDF files. |

## Manual MCP configuration

The app writes this for you; for other clients use:

```json
{
  "mcpServers": {
    "gui-hub": {
      "command": "<path to the GUI Hub executable>",
      "args": ["--mcp"]
    }
  }
}
```

macOS: `/Applications/GUI Hub.app/Contents/MacOS/GUI Hub` · Windows: `%LOCALAPPDATA%\Programs\gui-hub\GUI Hub.exe` · Linux: the AppImage path.

## Pricing

Free to download. Send Big Files (croc) is free; every other tool has 3 free uses (GUI or MCP). A one-time $19 Pro license unlocks everything, including future tools.

## About this repository

This repository hosts the website (HTML at the root) and the app's source (`source/`), from which the installers on the Releases page are built automatically. The source is published for transparency; it is not open source (all rights reserved). Each wrapped tool is developed by its own authors under its own license and is downloaded from its official release; none of them is affiliated with GUI Hub. Support: open an issue.

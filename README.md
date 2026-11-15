# GUI Hub — desktop GUI + MCP server for Caesium, croc, DuckDB, F2, FFmpeg, immich-go, Pandoc, pdfcpu, Typst

**Website and downloads:** https://muttyrab.github.io

## Quick start (MCP, no download)

```bash
npx -y github:MuttyRab/MuttyRab.github.io
```

- **Claude Code:** `claude mcp add gui-hub -- npx -y github:MuttyRab/MuttyRab.github.io`
- **Cursor / VS Code / Windsurf / Claude Desktop** (`mcpServers` config):

```json
{ "mcpServers": { "gui-hub": { "command": "npx", "args": ["-y", "github:MuttyRab/MuttyRab.github.io"] } } }
```

- **Claude Desktop, one click:** [gui-hub.mcpb](https://github.com/MuttyRab/MuttyRab.github.io/releases/latest/download/gui-hub.mcpb)
- Needs Node.js 18+. Each program is downloaded on first use from its official release and verified by SHA-256.

GUI Hub is a desktop app for **Windows, macOS and Linux** that gives well-known open-source command-line tools simple point-and-click forms — and exposes them as an **MCP (Model Context Protocol) server**, so Claude Desktop, Cursor, VS Code, Windsurf and other AI assistants can run them **locally**.

- No Node, Python or API keys to set up: one installer.
- One click in the app (**Use with AI**) connects Claude Desktop or Cursor.
- Runs the official, pinned, SHA-256-verified release of each tool.
- Files never leave your computer.

## MCP tools (29)

| Tool | What it does |
|---|---|
| `caesium_compress` | Compress, resize and/or convert image files (JPG, PNG, WebP, GIF, TIFF) on the user's computer. Writes compressed copies (same file names) into outDir; never modifies originals or overwrites existing files. Use mode=size with maxSize (bytes) to fit upload limits. |
| `caesium_folder` | Compress, resize and/or convert every image in a folder on the user's computer, optionally including subfolders (folder structure is kept). Copies go to outDir; originals are never modified. |
| `croc_receive` | Receive files sent with croc: give the code phrase from the sender and a destination folder. Existing files are kept (renamed) unless existing="overwrite". |
| `duckdb_summarize` | Inspect a local data file (CSV/TSV, Excel .xlsx, Parquet, JSON) without loading it into the chat: returns the first rows and per-column statistics (type, nulls, min, max, distinct count) as Markdown tables. Use this before writing a query. |
| `duckdb_convert` | Convert a local data file between CSV, Excel (.xlsx), Parquet and JSON. Writes a new file; the original is not changed. |
| `duckdb_combine` | Combine several local CSV files into one file (rows stacked, columns matched by name; missing columns become empty). Output format CSV, Excel, Parquet or JSON. |
| `duckdb_dedupe` | Write a copy of a local data file with exact duplicate rows removed (CSV, Excel, Parquet or JSON in; chosen format out). |
| `duckdb_query` | Run DuckDB SQL over local data files and get the answer as a Markdown table. Read files by quoted path: SELECT * FROM '/abs/path/file.csv' (also .xlsx, .parquet, .json; globs like '/dir/*.csv'). Use for totals, filters, group-bys, joins across files on data too big to paste into chat. Results are capped by the row limit; to save results use COPY (query) TO '/abs/out.xlsx' (FORMAT xlsx, HEADER true). |
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
| `pandoc_write` | Create a real document file on the user's computer from Markdown you write (pass the full text in `text`): Word (.docx), PowerPoint (.pptx — each `## heading` starts a new slide), OpenDocument (.odt), HTML, EPUB or RTF. The `out` file extension should match `to`. |
| `pdfcpu_merge` | Combine several PDFs into one, in the order listed. |
| `pdfcpu_split` | Split a PDF into smaller files. |
| `pdfcpu_optimize` | Shrink a PDF by removing duplicate and unused data. Text and images stay the same quality. |
| `pdfcpu_rotate` | Rotate all pages or a range of pages. |
| `pdfcpu_watermark` | Stamp text such as DRAFT or CONFIDENTIAL across every page. |
| `pdfcpu_encrypt` | Protect a PDF with AES-256 encryption. |
| `pdfcpu_decrypt` | Remove the password from a PDF you have the password for. |
| `pdfcpu_extract_pages` | Save selected pages as separate PDF files. |
| `typst_write` | Create a typeset PDF file on the user's computer from Typst markup you write (pass the full document in `source`). Typst syntax: `= Heading`, `*bold*`, `_italic_`, `- item`, `#table(columns: 2, [a], [b])`, `#set page(paper: "a4")`, `#set text(font: "New Computer Modern")`. Built-in fonts work offline. Relative image paths resolve inside `assets`. |
| `typst_compile` | Compile an existing .typ (Typst) file on the user's computer to PDF. |

## Using the desktop app as the MCP server

The app's **Use with AI** button writes this for you:

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

GUI Hub is a store of products, each a bundle of tools: **GUI Hub Essentials** (video, photos, Word/PowerPoint/PDF, renaming, sending — $9 once) and **GUI Hub Data** (CSV/Excel/Parquet/JSON with DuckDB — $9 once), or **All-Access** ($19 once, every product including future ones). One install includes everything; every tool has 3 free uses (GUI or MCP), Send Big Files is free. Serve one product to your AI with `--product=essentials` or `--product=data`. In an AI chat, the tools `gui_hub_status` (free uses left, purchase link) and `gui_hub_activate_license` (paste the key from the purchase email) handle upgrading without leaving the conversation.

## About this repository

This repository hosts the website (HTML at the root) and the app's source (`source/`), from which the installers on the Releases page are built automatically. The source is published for transparency; it is not open source (all rights reserved). Each wrapped tool is developed by its own authors under its own license and is downloaded from its official release; none of them is affiliated with GUI Hub. Support: open an issue.

# GUI Hub — desktop GUI + MCP server for 7-Zip, Caesium, GTCRN denoiser (sherpa-onnx), croc, DuckDB, F2, FFmpeg, immich-go, UVR + Whisper + FFmpeg, Pandoc, pdfcpu, Kokoro voices (sherpa-onnx), pyannote + TitaNet (sherpa-onnx), Whisper (sherpa-onnx), Typst, Real-ESRGAN, UVR MDX-Net (sherpa-onnx)

**Website and downloads:** https://guihub.cc

## Quick start (MCP, no download)

```bash
npx -y https://guihub.cc/mcp.tgz
```

- **One product only:** add `--product=essentials` (video, photos, Word/PowerPoint/PDF, renaming, sending) or `--product=data` (CSV/Excel/Parquet/JSON with DuckDB).
- **Claude Code:** `claude mcp add gui-hub -- npx -y https://guihub.cc/mcp.tgz`
- **Cursor / VS Code / Windsurf / Claude Desktop** (`mcpServers` config):

```json
{ "mcpServers": { "gui-hub": { "command": "npx", "args": ["-y", "https://guihub.cc/mcp.tgz"] } } }
```

- **Claude Desktop, one click:** [Essentials](https://guihub.cc/download/essentials/mcpb) · [Data](https://guihub.cc/download/data/mcpb)
- Needs Node.js 18+. Each program is downloaded on first use from its official release and verified by SHA-256.

GUI Hub is a desktop app for **Windows, macOS and Linux** that gives well-known open-source command-line tools simple point-and-click forms — and exposes them as an **MCP (Model Context Protocol) server**, so Claude Desktop, Cursor, VS Code, Windsurf and other AI assistants can run them **locally**.

- No Node, Python or API keys to set up: one installer.
- One click in the app (**Use with AI**) connects Claude Desktop or Cursor.
- Runs the official, pinned, SHA-256-verified release of each tool.
- Files never leave your computer.

## MCP tools (47)

| Tool | What it does |
|---|---|
| `7zip_extract` | Extract an archive (ZIP, RAR, 7z, TAR/GZ/XZ, ISO, …) on the user's computer into outDir. Give `password` for encrypted archives (it fails instead of prompting if one is needed). Existing files are not overwritten unless existing='a'. |
| `7zip_create` | Create a ZIP or 7z archive on the user's computer from files and/or a folder, optionally password-protected (7z: AES-256; ZIP: AES-256 by default, or classic ZipCrypto for compatibility with Windows Explorer). |
| `7zip_list` | List the contents (names, sizes, dates) of an archive on the user's computer without extracting it. |
| `7zip_test` | Test an archive's integrity (and password) on the user's computer without extracting. |
| `caesium_compress` | Compress, resize and/or convert image files (JPG, PNG, WebP, GIF, TIFF) on the user's computer. Writes compressed copies (same file names) into outDir; never modifies originals or overwrites existing files. Use mode=size with maxSize (bytes) to fit upload limits. File dates are kept by default (keepDates). |
| `caesium_folder` | Compress, resize and/or convert every image in a folder on the user's computer, optionally including subfolders (folder structure is kept). Copies go to outDir; originals are never modified. File dates are kept by default (keepDates). |
| `cleanvoice_denoise` | Remove background noise (hiss, hum, fans, traffic, room noise) from a speech recording on the user's computer — any audio or video file — offline, and save a cleaned .wav copy (16 kHz mono, optimised for speech). Use whenever the user wants to clean up, denoise or improve the audio of a voice memo, interview, podcast, lecture, call or video narration. Combine with transcription for better transcripts of noisy audio. |
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
| `ffmpeg_add_subtitles` | Add an .srt subtitle file to a video on the user's computer as a selectable subtitle track in a new MP4 (no re-encoding, full quality, fast). Use after transcribe_subtitles when the user wants captions inside the video file. |
| `ffmpeg_loudness` | Normalize the loudness of an audio or video file on the user's computer (EBU R128 loudnorm): makes quiet or uneven recordings loud and consistent at a chosen target (podcast/YouTube −14/−16 LUFS, broadcast −23). Video is copied unchanged. Use whenever the user says audio is too quiet, too loud, uneven, or wants it 'normalized' or 'podcast-ready'. |
| `ffmpeg_join` | Join (merge/concatenate) several video clips on the user's computer into one MP4, in the order given — works even when the clips differ in format, resolution or frame rate (each is converted to the same format first, then joined). Choose the output size (1080p/720p, landscape or portrait). Use whenever the user wants to combine, merge, stitch or join videos. Clips should all have sound or all be silent. |
| `immich_go_from_google_photos` | Import Google Photos Takeout .zip files into an Immich server (keeps albums, dates, GPS). dryRun defaults to true: run it first and report the summary before uploading for real. |
| `immich_go_from_folder` | Upload every photo and video in a folder and its subfolders. |
| `karaoke_make` | Make a karaoke video (MP4) from a song on the user's computer, offline: removes the vocals (UVR MDX-Net), recognises the sung lyrics with Whisper and burns them in as timed on-screen text over the instrumental. Use whenever the user wants a karaoke version, sing-along or lyrics video of a song. Set `language` to the song's language for better lyrics. |
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
| `pdfcpu_form_fields` | List the fillable fields of a PDF form on the user's computer (text fields, checkboxes, radio buttons, dropdowns, dates) with their names, ids and current values, as fill-ready JSON. ALWAYS call this first when the user wants a PDF form filled in (applications, tax forms, contracts, registration or intake forms); then put the user's answers into the 'value' entries and pass that JSON to pdfcpu_form_fill. |
| `pdfcpu_form_fill` | Fill in a PDF form on the user's computer and save a filled copy (the original is not changed). `data` is the JSON returned by pdfcpu_form_fields with each field's 'value' set (strings for text fields, true/false for checkboxes, the option text for dropdowns/radio buttons); fields you leave out keep their current value. Use for job/school/visa/tax applications, contracts, intake and registration forms. Ask the user for any answer you don't know instead of guessing. |
| `speak_speak` | Turn text into natural-sounding English speech and save it as a .wav audio file on the user's computer, offline (Kokoro voices; no account, no cloud). Use this whenever the user wants a voiceover, narration, podcast intro, audiobook chapter, announcement, or wants a document/notes read aloud or 'saved as audio'. Write or clean up the script first, then pass it as `text` (up to ~20,000 characters per call; split longer documents into chapters and call once per chapter). Pick `voice` to match the request (US/UK, female/male). |
| `speakers_diarize` | Detect who is speaking when in an audio or video recording on the user's computer (speaker diarization, offline): returns lines like '[00:01:05 → 00:01:20] Speaker 2'. Use for meetings, interviews, podcasts and calls when the user wants speaker labels or 'who said what' — run transcribe_transcribe with timestamps as well and match the times to label each line of the transcript with its speaker. Set `speakers` if the number of people is known. |
| `transcribe_transcribe` | Transcribe an audio or video file on the user's computer (mp3, m4a, wav, mp4, mov, …) to text with Whisper, offline. Returns the full transcript (optionally with [hh:mm:ss] timestamps) and can also save it to a .txt file (`out`). Set `translate` to get an English translation instead. Use this whenever the user wants a recording, voice memo, meeting or video turned into text, notes or a summary. |
| `transcribe_meeting` | Transcribe a meeting, interview, call or podcast recording on the user's computer into a speaker-labelled transcript ('[00:01:05] Speaker 2: …'), offline: Whisper speech-to-text plus speaker diarization in one step. Use whenever the user wants meeting notes, minutes, action items per person, an interview transcript, or 'who said what'. Afterwards you can rename 'Speaker 1/2' to real names if the user tells you who is who, and summarize. |
| `transcribe_subtitles` | Create subtitles/captions (.srt) for a video or audio file on the user's computer with Whisper, offline: speech is transcribed and timed into readable captions, in the spoken language or translated to English (`translate`). Use whenever the user wants subtitles, captions or an .srt for a video (YouTube, TikTok, Reels, lectures, accessibility). To put them into the video afterwards, call ffmpeg_add_subtitles. |
| `typst_write` | Create a typeset PDF file on the user's computer from Typst markup you write (pass the full document in `source`). Typst syntax: `= Heading`, `*bold*`, `_italic_`, `- item`, `#table(columns: 2, [a], [b])`, `#set page(paper: "a4")`, `#set text(font: "New Computer Modern")`. Built-in fonts work offline. Relative image paths resolve inside `assets`. |
| `typst_compile` | Compile an existing .typ (Typst) file on the user's computer to PDF. |
| `upscale_upscale` | Upscale/enhance an image on the user's computer 4× with Real-ESRGAN AI (offline): makes small, blurry or low-resolution photos and pictures larger and sharper, e.g. for printing, wallpapers or old photos. Input JPG/PNG/WebP; saves a new image (format from the output file extension). Choose `model` 'anime' for drawings, cartoons and anime art, otherwise 'photo'. Needs a GPU with Vulkan support (most computers from the last ~8 years). |
| `vocals_split` | Separate a song (any audio or video file on the user's computer) into an instrumental/karaoke track with the vocals removed and a vocals-only (acapella) track, offline with the UVR MDX-Net model. Saves two .wav files. Use whenever the user wants to remove vocals, make karaoke or a backing track, get an instrumental, or isolate/extract vocals or an acapella from a song. Takes roughly the song's length to run. |

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

GUI Hub has three apps — **Essentials** (video, photos, Word/PowerPoint/PDF, transcription, renaming, sending), **Data** (CSV/Excel/Parquet/JSON with DuckDB) and **Audio** (text to speech, vocal remover, voice clean-up, karaoke, who spoke when) — and **one license: $9 once unlocks every tool in every app**, including tools added later. Every tool has 3 free uses (GUI or MCP), Send Big Files is free. Serve one app to your AI with `--product=essentials`, `--product=data` or `--product=audio`. In an AI chat, the tools `gui_hub_status` (free uses left, purchase link) and `gui_hub_activate_license` (paste the key from the purchase email) handle upgrading without leaving the conversation.

## Free browser tools (no upload)

- [Free text to speech (AI voices)](https://guihub.cc/free/text-to-speech-free.html)
- [Transcribe audio to text](https://guihub.cc/free/transcribe-audio-to-text-free.html)
- [Compress a video for Discord](https://guihub.cc/free/compress-video-for-discord.html)
- [Compress a video to 25 MB (email)](https://guihub.cc/free/compress-video-to-25mb.html)
- [Video to GIF](https://guihub.cc/free/video-to-gif.html)
- [Trim a video](https://guihub.cc/free/trim-video.html)
- [MOV to MP4](https://guihub.cc/free/mov-to-mp4.html)
- [MP4 to MP3](https://guihub.cc/free/mp4-to-mp3.html)
- [JPG to PDF](https://guihub.cc/free/jpg-to-pdf.html)
- [PDF to JPG](https://guihub.cc/free/pdf-to-jpg.html)
- [Merge PDF files](https://guihub.cc/free/merge-pdf-free.html)
- [Compress an image to 100 KB](https://guihub.cc/free/compress-image-to-100kb.html)
- [CSV to Excel](https://guihub.cc/free/csv-to-excel-free.html)
- [All free tools](https://guihub.cc/free/)

## Guides

- [How to merge, compress and password-protect PDFs offline (Mac, Windows, Linux)](https://guihub.cc/guides/merge-compress-protect-pdf-offline.html)
- [How to bulk rename hundreds of files safely — with a preview and undo](https://guihub.cc/guides/bulk-rename-files-with-preview.html)
- [Send large files between two computers without uploading to the cloud — free](https://guihub.cc/guides/send-large-files-without-cloud.html)
- [How to move Google Photos to Immich (Google Takeout import) step by step](https://guihub.cc/guides/google-takeout-to-immich-without-command-line.html)
- [How to compress a video for Discord, email or WhatsApp — free of uploads, on your own computer](https://guihub.cc/guides/compress-video-for-discord-email-offline.html)
- [How to turn a video clip into a high-quality GIF (Mac, Windows, Linux)](https://guihub.cc/guides/video-to-gif-high-quality.html)
- [How to extract the audio from a video as MP3 — offline](https://guihub.cc/guides/extract-audio-from-video-mp3.html)
- [How to convert a Word document to Markdown (for ChatGPT, Claude or Obsidian)](https://guihub.cc/guides/convert-word-to-markdown-for-chatgpt-claude.html)
- [How to convert Markdown to a Word document (.docx) — with a table of contents](https://guihub.cc/guides/convert-markdown-to-word-docx.html)
- [How to compress photos for email, websites and upload limits (offline, Mac, Windows, Linux)](https://guihub.cc/guides/compress-images-for-email-and-web.html)
- [How to let Claude or Cursor create real Word and PowerPoint files on your computer](https://guihub.cc/guides/ai-create-word-powerpoint-files.html)
- [How to make a polished PDF from text with Claude or ChatGPT — no Word, no upload](https://guihub.cc/guides/make-pdf-from-text-with-ai.html)
- [How to combine many CSV files into one Excel file (Mac, Windows, Linux — no code)](https://guihub.cc/guides/combine-csv-files-into-one-excel.html)
- [How to let Claude or Cursor analyse a big CSV or Excel file on your computer](https://guihub.cc/guides/ai-analyze-large-csv-excel-locally.html)
- [An offline TinyPNG alternative for whole folders of photos](https://guihub.cc/guides/tinypng-alternative-offline-batch.html)
- [An offline alternative to online PDF tools (merge, compress, password)](https://guihub.cc/guides/ilovepdf-alternative-offline.html)
- [A simpler alternative to HandBrake for shrinking videos](https://guihub.cc/guides/handbrake-alternative-simple-video-compressor.html)
- [Convert CSV to Excel (and back) without uploading your data](https://guihub.cc/guides/csv-to-excel-without-uploading.html)
- [How to open RAR and 7z files (Mac, Windows, Linux) and make a password-protected ZIP](https://guihub.cc/guides/open-rar-7z-files-mac-windows-zip-with-password.html)
- [How to transcribe audio or video to text offline (and let Claude summarize it)](https://guihub.cc/guides/transcribe-audio-video-to-text-offline.html)
- [An offline alternative to LALAL.AI and online vocal removers](https://guihub.cc/guides/lalal-ai-alternative-offline-vocal-remover.html)
- [An offline alternative to Otter.ai for meeting transcripts with speaker names](https://guihub.cc/guides/otter-ai-alternative-offline-meeting-transcription.html)
- [A free-to-try offline alternative to ElevenLabs for voiceovers](https://guihub.cc/guides/elevenlabs-alternative-offline-text-to-speech.html)
- [A simple offline alternative to Topaz Gigapixel for upscaling photos](https://guihub.cc/guides/topaz-gigapixel-alternative-free-ai-upscaler.html)
- [Remove background noise from a voice recording — offline, no upload](https://guihub.cc/guides/remove-background-noise-from-audio-offline.html)
- [Add subtitles to a video automatically — offline, no watermark](https://guihub.cc/guides/auto-subtitles-for-video-offline.html)
- [Fill in a PDF form without Adobe Acrobat (or let your AI fill it)](https://guihub.cc/guides/fill-pdf-form-without-adobe-acrobat.html)
- [Make a karaoke video from any song — lyrics on screen, vocals removed](https://guihub.cc/guides/make-karaoke-video-from-any-song.html)
- [Join several videos into one — free to try, no watermark, no upload](https://guihub.cc/guides/join-videos-into-one-without-watermark.html)

## About this repository

This repository hosts the website (HTML at the root) and the app's source (`source/`), from which the installers on the Releases page are built automatically. The source is published for transparency; it is not open source (all rights reserved). Each wrapped tool is developed by its own authors under its own license and is downloaded from its official release; none of them is affiliated with GUI Hub. Support: open an issue.

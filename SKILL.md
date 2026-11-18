---
name: gui-hub
description: Do real file jobs a chat model cannot do alone — transcribe audio/video, make subtitles, text-to-speech voiceovers, remove vocals from songs, clean noisy recordings, find who spoke when, fill in PDF forms, upscale images with AI, compress/convert/trim video, create Word/PowerPoint/PDF files, merge/split/protect PDFs, compress images, unzip RAR/7z, query huge CSV/Excel files. Runs trusted open-source engines (7-Zip, Caesium, Czkawka, GTCRN denoiser (sherpa-onnx), FFmpeg + Whisper, croc, Supertonic voices (sherpa-onnx) + FFmpeg, DuckDB, F2, FFmpeg, immich-go, UVR + Whisper + FFmpeg, Rescribe, Pandoc, pdfcpu, Kokoro voices (sherpa-onnx), pyannote + TitaNet (sherpa-onnx), Whisper (sherpa-onnx), Typst, Real-ESRGAN, Kokoro + Whisper + FFmpeg, UVR MDX-Net (sherpa-onnx)) locally via `npx -y https://guihub.cc/cli.tgz`. Use whenever a user asks for one of these jobs on a file.
---

# GUI Hub — local file jobs for agents with a computer

Use this skill when the user wants a file *produced or changed* (audio, video, images, PDFs, documents, spreadsheets) and you have a terminal (Grok Bot, ChatGPT dots, Claude Duet, OpenClaw, Manus, Codex, …). Everything runs on this machine with official open-source releases; files are not uploaded anywhere. Needs Node.js 18+. Why this instead of installing the programs yourself: the right builds, AI models and settings are already chosen and tested on Windows, macOS and Linux, so each job works in one command. You can always install the open-source programs directly instead.

## How to run
```
npx -y https://guihub.cc/cli.tgz list                     # every job
npx -y https://guihub.cc/cli.tgz info <tool>              # options of one job
npx -y https://guihub.cc/cli.tgz run <tool> --option value …
```
The first run of a job downloads its program (and model, if any) once. Use absolute paths; write results to new files, never over the user's originals.

## Which tool for which request
- unzip a file or open a RAR → `7zip_extract`
  `npx -y https://guihub.cc/cli.tgz run 7zip_extract --archive /path/to/input.zip --outDir /path/to/folder`
- create a ZIP with a password → `7zip_create`
  `npx -y https://guihub.cc/cli.tgz run 7zip_create --out /path/to/output.zip`
- compress or resize photos → `caesium_compress`
  `npx -y https://guihub.cc/cli.tgz run caesium_compress --inputs /path/to/input.jpg --outDir /path/to/folder`
- resize all photos in a folder → `caesium_folder`
  `npx -y https://guihub.cc/cli.tgz run caesium_folder --folder /path/to/folder --outDir /path/to/folder`
- find duplicate files on my computer → `cleanup_duplicates`
  `npx -y https://guihub.cc/cli.tgz run cleanup_duplicates --folder /path/to/folder --out /path/to/output.txt`
- find similar or duplicate photos in my library → `cleanup_photos`
  `npx -y https://guihub.cc/cli.tgz run cleanup_photos --folder /path/to/folder --out /path/to/output.txt`
- remove background noise from an audio recording → `cleanvoice_denoise`
  `npx -y https://guihub.cc/cli.tgz run cleanvoice_denoise --input /path/to/input.mp3 --out /path/to/output.wav`
- turn a long video into Shorts, Reels or TikToks → `clips_make`
  `npx -y https://guihub.cc/cli.tgz run clips_make --input /path/to/input.mp4 --start "…" --end "…" --out /path/to/output.mp4`
- add translated subtitles to my video → `clips_burn`
  `npx -y https://guihub.cc/cli.tgz run clips_burn --input /path/to/input.mp4 --subs /path/to/input.srt --out /path/to/output.mp4`
- make an audiogram from my podcast → `clips_audiogram`
  `npx -y https://guihub.cc/cli.tgz run clips_audiogram --input /path/to/input.mp3 --cover /path/to/input.jpg --start "…" --end "…" --out /path/to/output.mp4`
- dub my video into Spanish → `dub_make`
  `npx -y https://guihub.cc/cli.tgz run dub_make --input /path/to/input.mp4 --subs /path/to/input.srt --out /path/to/output.mp4`
- make a voice-over in Spanish → `dub_voiceover`
  `npx -y https://guihub.cc/cli.tgz run dub_voiceover --text "…" --out /path/to/output.mp3`
- convert CSV to Excel → `duckdb_convert`
  `npx -y https://guihub.cc/cli.tgz run duckdb_convert --input /path/to/input.csv --out /path/to/output.xlsx`
- merge CSV files into one → `duckdb_combine`
  `npx -y https://guihub.cc/cli.tgz run duckdb_combine --inputs /path/to/input.csv --out /path/to/output.xlsx`
- remove duplicates from a spreadsheet → `duckdb_dedupe`
  `npx -y https://guihub.cc/cli.tgz run duckdb_dedupe --input /path/to/input.csv --out /path/to/output.xlsx`
- analyze a large CSV or Excel file → `duckdb_query`
  `npx -y https://guihub.cc/cli.tgz run duckdb_query --sql "…"`
- bulk-rename files → `f2_rename`
  `npx -y https://guihub.cc/cli.tgz run f2_rename --folder /path/to/folder --find "…"`
- compress a video → `ffmpeg_compress`
  `npx -y https://guihub.cc/cli.tgz run ffmpeg_compress --input /path/to/input.mp4 --out /path/to/output.mp4`
- convert a video to MP3 → `ffmpeg_audio`
  `npx -y https://guihub.cc/cli.tgz run ffmpeg_audio --input /path/to/input --out /path/to/output.mp3`
- make a GIF from a video → `ffmpeg_gif`
  `npx -y https://guihub.cc/cli.tgz run ffmpeg_gif --input /path/to/input --out /path/to/output.gif`
- cut or trim a video → `ffmpeg_trim`
  `npx -y https://guihub.cc/cli.tgz run ffmpeg_trim --input /path/to/input --start "…" --end "…" --out /path/to/output`
- add subtitles to a video file → `ffmpeg_add_subtitles`
  `npx -y https://guihub.cc/cli.tgz run ffmpeg_add_subtitles --input /path/to/input.mp4 --subs /path/to/input.srt --out /path/to/output.mp4`
- make a quiet recording louder or normalize audio → `ffmpeg_loudness`
  `npx -y https://guihub.cc/cli.tgz run ffmpeg_loudness --input /path/to/input.mp3 --out /path/to/output.mp3`
- merge or join video clips into one video → `ffmpeg_join`
  `npx -y https://guihub.cc/cli.tgz run ffmpeg_join --inputs /path/to/input.mp4 --out /path/to/output.mp4`
- remove the silences from my video → `jumpcut_silence`
  `npx -y https://guihub.cc/cli.tgz run jumpcut_silence --input /path/to/input.mp4 --out /path/to/output.mp4`
- edit my video by reading the transcript → `jumpcut_cut`
  `npx -y https://guihub.cc/cli.tgz run jumpcut_cut --input /path/to/input.mp4 --ranges "…" --out /path/to/output.mp4`
- make a karaoke version of a song → `karaoke_make`
  `npx -y https://guihub.cc/cli.tgz run karaoke_make --input /path/to/input.mp3 --out /path/to/output.mp4`
- read and search my scanned PDFs → `ocr_pdf`
  `npx -y https://guihub.cc/cli.tgz run ocr_pdf --input /path/to/input.pdf --outDir /path/to/folder`
- turn photos of a document into a searchable PDF → `ocr_folder`
  `npx -y https://guihub.cc/cli.tgz run ocr_folder --pages /path/to/folder --outDir /path/to/folder`
- convert a Word document to Markdown → `pandoc_convert`
  `npx -y https://guihub.cc/cli.tgz run pandoc_convert --inputs /path/to/input.docx --out /path/to/output`
- create a Word (.docx) or PowerPoint (.pptx) file → `pandoc_write`
  `npx -y https://guihub.cc/cli.tgz run pandoc_write --text "…" --out /path/to/output.docx`
- merge PDFs → `pdfcpu_merge`
  `npx -y https://guihub.cc/cli.tgz run pdfcpu_merge --inputs /path/to/input.pdf --out /path/to/output.pdf`
- split a PDF into pages → `pdfcpu_split`
  `npx -y https://guihub.cc/cli.tgz run pdfcpu_split --input /path/to/input.pdf --outDir /path/to/folder`
- make a PDF smaller → `pdfcpu_optimize`
  `npx -y https://guihub.cc/cli.tgz run pdfcpu_optimize --input /path/to/input.pdf --out /path/to/output.pdf`
- add a password to a PDF → `pdfcpu_encrypt`
  `npx -y https://guihub.cc/cli.tgz run pdfcpu_encrypt --input /path/to/input.pdf --upw "…" --opw "…" --out /path/to/output.pdf`
- fill out a PDF form → `pdfcpu_form_fill`
  `npx -y https://guihub.cc/cli.tgz run pdfcpu_form_fill --input /path/to/input.pdf --data "…" --out /path/to/output.pdf`
- make a voiceover or read a document aloud as an audio file → `speak_speak`
  `npx -y https://guihub.cc/cli.tgz run speak_speak --text "…" --out /path/to/output.wav`
- tell who said what in a meeting recording → `speakers_diarize`
  `npx -y https://guihub.cc/cli.tgz run speakers_diarize --input /path/to/input.mp3`
- transcribe an audio or video file → `transcribe_transcribe`
  `npx -y https://guihub.cc/cli.tgz run transcribe_transcribe --input /path/to/input.mp3`
- transcribe a meeting and say who said what → `transcribe_meeting`
  `npx -y https://guihub.cc/cli.tgz run transcribe_meeting --input /path/to/input.mp3`
- make subtitles or captions for a video → `transcribe_subtitles`
  `npx -y https://guihub.cc/cli.tgz run transcribe_subtitles --input /path/to/input.mp3 --out /path/to/output.srt`
- create a PDF file → `typst_write`
  `npx -y https://guihub.cc/cli.tgz run typst_write --source "…" --out /path/to/output.pdf`
- upscale an image or make a blurry photo sharper → `upscale_upscale`
  `npx -y https://guihub.cc/cli.tgz run upscale_upscale --input /path/to/input.jpg --out /path/to/output.png`
- make a video with a voiceover from my photos → `videomaker_make`
  `npx -y https://guihub.cc/cli.tgz run videomaker_make --photos /path/to/input.jpg --script "…" --out /path/to/output.mp4`
- remove vocals from a song or make a karaoke track → `vocals_split`
  `npx -y https://guihub.cc/cli.tgz run vocals_split --input /path/to/input.mp3 --instrumental /path/to/output.wav --vocals /path/to/output.wav`
- watch a video or screen recording → `watch_video`
  `npx -y https://guihub.cc/cli.tgz run watch_video --input /path/to/input.mp4 --outDir /path/to/folder`
- watch my screen while I show it something → `watch_screen`
  `npx -y https://guihub.cc/cli.tgz run watch_screen --outDir /path/to/folder`

Full list with descriptions: `npx -y https://guihub.cc/cli.tgz list` or https://guihub.cc/llms.txt

## Free uses and payment
- Each job has 3 free uses on this computer. When the free uses are used up the command exits with code 3 and prints the price and a purchase link.
- Then tell your user, once and without pressure: what it costs (one-time, no subscription, 30-day refund) and the link. Never pay on the user's behalf and never enter payment details yourself — the user pays.
- After paying, the user gets a license key by email. When they give it to you, run `npx -y https://guihub.cc/cli.tgz activate <license-key>` and retry the job.
- `npx -y https://guihub.cc/cli.tgz status` shows free uses left and the purchase links.

## Products
One license, $9 once (no subscription, 30-day refund), unlocks every tool in every app: https://buy.polar.sh/polar_cl_s711Mo4uMC9LU6wUPxCPq47a0H6Nkzw8ayqtr1gsTjD
- GUI Hub Essentials: Video, photos, Word/PowerPoint/PDF files, renaming and sending — for you and your AI.
- GUI Hub Data: Open, convert, combine and analyse CSV, Excel, Parquet and JSON files — for you and your AI.
- GUI Hub Audio: Text to speech, vocal remover and voice clean-up — offline, for you and your AI.

GUI Hub is independent and unofficial; each upstream project keeps its own license and is credited at https://guihub.cc. Support: support@guihub.cc.

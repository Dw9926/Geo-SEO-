# AudioSlides AI — Audiobook Visualizer

Turn an audiobook chapter, lecture, or podcast into a visual journey. The app
transcribes the audio, breaks it into scenes, and generates an AI illustration
for each scene so listeners can *see* what the book or speaker is describing.

## Pipeline

1. **Upload** an audio file (mp3 / wav / m4a / mp4 / mpga / mpeg / webm, ≤ 25 MB).
2. **Transcribe** with OpenAI Whisper (`whisper-1`).
3. **Structure** the transcript into 5–20 scene slides (title, 3 bullets, and a
   concrete, paintable `visual_concept`) using Claude or GPT-4o.
4. **Illustrate** each scene with OpenAI's image API (`gpt-image-1`, falling
   back to `dall-e-3`) in a consistent art style you pick (storybook
   watercolor, cinematic, graphic novel, flat illustration, dreamlike painting).
5. **Present** the result as a click-through deck or grid overview, with the
   deck downloadable as JSON.

## Run it

```bash
pip install -r requirements.txt
streamlit run app.py
```

Enter your API keys in the sidebar (or set `OPENAI_API_KEY` /
`ANTHROPIC_API_KEY` in the environment before launching — the sidebar fields
pre-fill from them).

## Cost notes

- Whisper bills per minute of audio.
- Each scene illustration is a separate image-API call, so a 15-scene deck is
  15 image generations. Images can be generated all at once (Step 3) or one at
  a time as you click through the deck.

## Scope

Single-file Streamlit prototype: no auth, database, billing, or job queue.
Everything runs synchronously in the Streamlit session and decks live in
`session_state` only.

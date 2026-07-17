"""
AudioSlides AI -- Audiobook Visualizer
======================================
Convert long-form audio (audiobooks, lectures, podcasts) into a structured,
click-through visual deck, so listeners can SEE what the book or speaker is
describing -- scene by scene.

Pipeline:
    1. User uploads an audio file (mp3 / wav / m4a / mp4 / mpga / mpeg / webm).
    2. OpenAI Whisper API transcribes the audio to text.
    3. An LLM (Anthropic Claude or OpenAI GPT-4o) restructures the transcript
       into a strict JSON array of visual "scene" slides.
    4. OpenAI's image API turns each scene description into an actual
       illustration, in a user-selected art style.
    5. Streamlit renders the slides as a navigable, presentation-style deck.

Run:
    pip install streamlit openai anthropic
    streamlit run app.py

Notes on scope:
    This is a single-file prototype, not a hardened multi-tenant SaaS backend.
    There is no user auth, billing, persistent database, or background job
    queue here -- everything runs synchronously inside the Streamlit session.
    For a real production deployment you would want to move the transcription,
    structuring, and image-generation calls into an async worker/queue,
    persist decks to a database instead of session_state, add auth, and chunk
    transcripts that exceed a single LLM context window (rare for this use
    case, but possible for very long audiobooks).
"""

import html
import json
import os
import re
import tempfile
import traceback
from typing import List, Optional

import streamlit as st

# ------------------------------------------------------------------------
# Optional SDK imports -- guarded so the app still loads (with a clear
# error message) even if one of the two provider packages isn't installed.
# ------------------------------------------------------------------------
try:
    from openai import OpenAI
    OPENAI_SDK_AVAILABLE = True
except ImportError:
    OPENAI_SDK_AVAILABLE = False

try:
    from anthropic import Anthropic
    ANTHROPIC_SDK_AVAILABLE = True
except ImportError:
    ANTHROPIC_SDK_AVAILABLE = False


# ============================================================================
# CONFIG
# ============================================================================

MAX_FILE_SIZE_MB = 25  # Hard limit enforced by the Whisper API
SUPPORTED_EXTENSIONS = ["mp3", "wav", "m4a", "mp4", "mpga", "mpeg", "webm"]

WHISPER_MODEL = "whisper-1"
ANTHROPIC_MODEL = "claude-sonnet-5"
OPENAI_STRUCTURING_MODEL = "gpt-4o"

# Primary image model with an automatic fallback for accounts that don't
# have gpt-image-1 access yet.
IMAGE_MODEL_PRIMARY = "gpt-image-1"
IMAGE_MODEL_FALLBACK = "dall-e-3"

STYLE_PRESETS = {
    "Storybook watercolor": (
        "soft watercolor storybook illustration, gentle brush strokes, warm "
        "light, muted palette, hand-painted texture"
    ),
    "Cinematic": (
        "cinematic film still, dramatic lighting, shallow depth of field, "
        "rich color grading, wide-angle composition"
    ),
    "Graphic novel": (
        "bold graphic novel panel, inked linework, high-contrast shadows, "
        "expressive composition, muted comic color palette"
    ),
    "Minimal flat illustration": (
        "clean flat vector illustration, simple geometric shapes, limited "
        "modern color palette, generous negative space"
    ),
    "Dreamlike painting": (
        "dreamlike oil painting, soft edges, atmospheric haze, luminous "
        "color, impressionistic detail"
    ),
}

MIN_SLIDES_HINT = 5
MAX_SLIDES_HINT = 20

SLIDE_SCHEMA_DESCRIPTION = f"""
Break the transcript into a logical sequence of visual scenes that a listener
could follow along with -- the goal is to help someone SEE what the book or
speaker is describing. Create one slide per major idea, scene, topic shift,
or key argument -- roughly one slide per 60-120 seconds of spoken content.
Produce between {MIN_SLIDES_HINT} and {MAX_SLIDES_HINT} slides depending on
the length and density of the transcript.

Each slide object must have EXACTLY these four fields:
- "slide_number": integer, sequential starting at 1
- "title": a short, punchy string (max ~8 words) naming the slide's core idea
- "bullets": an array of EXACTLY 3 strings. Each bullet is a concise, complete
  thought (max ~15 words), not a sentence fragment and not a verbatim quote
  from the transcript.
- "visual_concept": a single vivid sentence describing a CONCRETE, paintable
  scene that visually captures this moment -- name the subject, the setting,
  the mood, and one or two specific visual details (e.g. "A lone lighthouse
  keeper climbing a spiral staircase at dusk, storm clouds gathering through
  a small round window"). It will be fed directly to an image-generation
  model, so describe what should literally appear in the picture -- never
  reference 'the transcript', 'the speaker', or 'this slide'.

Rules:
- Titles and bullets must be grounded only in the transcript's actual
  content. Never invent facts, numbers, names, or claims that are not
  present in the source material.
- The visual_concept may creatively stage the scene, but its subject matter
  must come from the transcript.
- Do not pad the deck with filler slides just to hit a slide count.
- Keep language clear and presentation-ready -- rewritten and condensed,
  not copy-pasted from the transcript.
"""

SYSTEM_PROMPT_ANTHROPIC = f"""You are a professional visual storyteller and \
information architect. Your sole task is to convert a raw audio transcript \
into a structured, visualizable slide deck.

{SLIDE_SCHEMA_DESCRIPTION}

OUTPUT FORMAT -- CRITICAL:
Respond with ONLY a single, valid, top-level JSON array of slide objects that \
exactly matches the schema above. Do not include any explanation, preamble, \
apology, markdown code fences, or any text of any kind before or after the \
JSON array. Your entire response must be parseable by json.loads() with no \
modification whatsoever."""

SYSTEM_PROMPT_OPENAI = f"""You are a professional visual storyteller and \
information architect. Your sole task is to convert a raw audio transcript \
into a structured, visualizable slide deck.

{SLIDE_SCHEMA_DESCRIPTION}

OUTPUT FORMAT -- CRITICAL:
Respond with ONLY a single valid JSON object containing exactly one key, \
"slides", whose value is the JSON array of slide objects described above. \
Do not include any explanation, preamble, or text outside that JSON object."""

ICON_RULES = [
    (("chart", "graph", "trend", "growth", "data", "statistic", "number"), "📊"),
    (("team", "people", "collaborat", "audience", "community", "crowd"), "👥"),
    (("idea", "insight", "concept", "brain", "innovation", "spark"), "💡"),
    (("money", "revenue", "cost", "financ", "budget", "profit", "price"), "💰"),
    (("time", "clock", "schedule", "timeline", "history", "era"), "⏱️"),
    (("warning", "risk", "danger", "caution", "threat"), "⚠️"),
    (("goal", "target", "objective", "milestone", "aim"), "🎯"),
    (("book", "read", "story", "chapter", "lecture", "author"), "📖"),
    (("world", "global", "map", "location", "country"), "🌍"),
    (("tech", "software", "code", "system", "algorithm", "engine"), "🖥️"),
    (("ai", "model", "neural", "machine learning"), "🤖"),
    (("nature", "environment", "climate", "planet", "earth"), "🌿"),
    (("quote", "speak", "voice", "say", "conversation", "dialogue"), "🗣️"),
    (("question", "why", "how", "curious"), "❓"),
    (("heart", "love", "care", "emotion", "feeling"), "❤️"),
    (("build", "construct", "structure", "foundation", "architecture"), "🏗️"),
]
DEFAULT_ICON = "🖼️"


# ============================================================================
# STREAMLIT PAGE SETUP
# ============================================================================

st.set_page_config(
    page_title="AudioSlides AI",
    page_icon="🎙️",
    layout="wide",
    initial_sidebar_state="expanded",
)


def inject_custom_css() -> None:
    st.markdown(
        """
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

            html, body, [class*="css"] {
                font-family: 'Inter', -apple-system, sans-serif;
            }

            .app-hero {
                padding: 1.75rem 2rem;
                border-radius: 18px;
                background: linear-gradient(120deg, #4338ca 0%, #6d28d9 50%, #a21caf 100%);
                margin-bottom: 1.75rem;
                box-shadow: 0 10px 30px rgba(76, 29, 149, 0.25);
            }
            .app-hero-badge {
                display: inline-block;
                background: rgba(255,255,255,0.18);
                color: #fff;
                font-size: 0.72rem;
                font-weight: 700;
                letter-spacing: 0.08em;
                padding: 0.2rem 0.65rem;
                border-radius: 999px;
                margin-bottom: 0.6rem;
            }
            .app-hero h1 {
                color: #ffffff;
                font-size: 2.1rem;
                font-weight: 800;
                margin: 0 0 0.35rem 0;
            }
            .app-hero p {
                color: rgba(255,255,255,0.88);
                font-size: 1.02rem;
                margin: 0;
                max-width: 700px;
            }

            .stage-label {
                display: inline-block;
                background: #ede9fe;
                color: #5b21b6;
                font-weight: 700;
                font-size: 0.78rem;
                letter-spacing: 0.05em;
                padding: 0.15rem 0.6rem;
                border-radius: 6px;
                margin-bottom: 0.5rem;
            }

            .slide-card {
                background: #ffffff;
                border-radius: 20px;
                padding: 2.4rem 2.6rem 2rem 2.6rem;
                box-shadow: 0 8px 28px rgba(15, 23, 42, 0.10);
                border: 1px solid #ede9fe;
                position: relative;
                min-height: 420px;
                margin-bottom: 1rem;
            }
            .slide-card::before {
                content: "";
                position: absolute;
                top: 0; left: 0; right: 0;
                height: 6px;
                border-radius: 20px 20px 0 0;
                background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);
            }
            .slide-badge {
                display: inline-block;
                background: #f5f3ff;
                color: #6d28d9;
                font-weight: 700;
                font-size: 0.75rem;
                letter-spacing: 0.06em;
                padding: 0.25rem 0.7rem;
                border-radius: 999px;
                margin-bottom: 1rem;
            }
            .slide-title {
                font-size: 2rem;
                font-weight: 800;
                color: #1e1b3a;
                line-height: 1.2;
                margin-bottom: 1.6rem;
            }
            .bullet-list {
                list-style: none;
                padding: 0;
                margin: 0 0 1.8rem 0;
            }
            .bullet-item {
                display: flex;
                align-items: flex-start;
                gap: 0.7rem;
                font-size: 1.08rem;
                color: #33324a;
                margin-bottom: 0.85rem;
                line-height: 1.5;
            }
            .bullet-item::before {
                content: "";
                flex-shrink: 0;
                width: 9px;
                height: 9px;
                margin-top: 0.45rem;
                border-radius: 50%;
                background: linear-gradient(135deg, #6366f1, #a855f7);
            }
            .scene-image {
                width: 100%;
                border-radius: 14px;
                margin-bottom: 1.1rem;
                box-shadow: 0 6px 20px rgba(15, 23, 42, 0.12);
            }
            .visual-box {
                background: #faf9ff;
                border: 1.5px dashed #c4b5fd;
                border-radius: 14px;
                padding: 1.1rem 1.4rem;
                display: flex;
                align-items: center;
                gap: 1rem;
            }
            .visual-icon {
                font-size: 2rem;
                line-height: 1;
            }
            .visual-copy {
                display: flex;
                flex-direction: column;
                gap: 0.15rem;
            }
            .visual-label {
                font-size: 0.68rem;
                font-weight: 800;
                letter-spacing: 0.08em;
                color: #7c3aed;
            }
            .visual-text {
                font-size: 0.95rem;
                color: #514f6b;
            }

            .grid-slide-card {
                background: #ffffff;
                border-radius: 14px;
                padding: 1.2rem 1.3rem;
                border: 1px solid #ede9fe;
                box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
                margin-bottom: 1rem;
                min-height: 200px;
            }
            .grid-slide-image {
                width: 100%;
                border-radius: 10px;
                margin-bottom: 0.6rem;
            }
            .grid-slide-badge {
                font-size: 0.68rem;
                font-weight: 700;
                color: #7c3aed;
                margin-bottom: 0.4rem;
                display: block;
            }
            .grid-slide-title {
                font-size: 1.05rem;
                font-weight: 700;
                color: #1e1b3a;
                margin-bottom: 0.6rem;
            }
            .grid-slide-bullet {
                font-size: 0.85rem;
                color: #514f6b;
                margin-bottom: 0.25rem;
            }

            .dots-container {
                display: flex;
                justify-content: center;
                gap: 0.4rem;
                margin: 0.75rem 0 1.25rem 0;
            }
            .dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #e2ddfb;
                display: inline-block;
            }
            .dot.active {
                background: linear-gradient(135deg, #6366f1, #a855f7);
                width: 22px;
                border-radius: 5px;
            }

            div.stButton > button {
                border-radius: 10px;
                font-weight: 600;
                border: 1px solid #ddd6fe;
            }
        </style>
        """,
        unsafe_allow_html=True,
    )


# ============================================================================
# SESSION STATE
# ============================================================================

def init_session_state() -> None:
    defaults = {
        "transcript": None,
        "slides": None,
        "slide_images": {},  # slide_number -> base64-encoded PNG
        "current_slide_idx": 0,
        "last_uploaded_filename": None,
        "last_error": None,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def reset_deck_state() -> None:
    st.session_state.transcript = None
    st.session_state.slides = None
    st.session_state.slide_images = {}
    st.session_state.current_slide_idx = 0
    st.session_state.last_error = None


# ============================================================================
# VALIDATION HELPERS
# ============================================================================

def validate_uploaded_file(uploaded_file) -> Optional[str]:
    """Returns an error message string if the file is invalid, else None."""
    if uploaded_file is None:
        return "No file uploaded."

    ext = os.path.splitext(uploaded_file.name)[1].lstrip(".").lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return (
            f"Unsupported file type '.{ext}'. Supported formats: "
            f"{', '.join(SUPPORTED_EXTENSIONS)}."
        )

    size_mb = uploaded_file.size / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        return (
            f"File is {size_mb:.1f} MB, which exceeds the Whisper API's "
            f"{MAX_FILE_SIZE_MB} MB limit. Please split the audio into "
            f"smaller chapters/segments or re-export at a lower bitrate."
        )
    return None


def require_api_key(key: Optional[str], provider_label: str) -> bool:
    if not key or not key.strip():
        st.error(f"Missing API key: please enter your {provider_label} API key in the sidebar.")
        return False
    return True


# ============================================================================
# TRANSCRIPTION (Whisper)
# ============================================================================

def transcribe_audio(uploaded_file, api_key: str) -> str:
    if not OPENAI_SDK_AVAILABLE:
        raise RuntimeError(
            "The 'openai' package is not installed. Run: pip install openai"
        )

    client = OpenAI(api_key=api_key)
    suffix = os.path.splitext(uploaded_file.name)[1] or ".mp3"

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(uploaded_file.getvalue())
            tmp_path = tmp.name

        with open(tmp_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=audio_file,
                response_format="text",
            )

        # Depending on SDK version, response_format="text" returns either a
        # plain string or an object exposing a `.text` attribute.
        if isinstance(response, str):
            transcript = response
        else:
            transcript = getattr(response, "text", None) or str(response)

        transcript = transcript.strip()
        if not transcript:
            raise ValueError(
                "Whisper returned an empty transcript. The audio may be "
                "silent, corrupted, or in an unsupported codec."
            )
        return transcript
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ============================================================================
# JSON EXTRACTION / REPAIR HELPERS
# ============================================================================

def strip_markdown_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def extract_json_array(raw_text: str) -> str:
    """
    Locate and return the first complete, top-level JSON array substring in
    `raw_text`, tolerating markdown code fences and any stray commentary the
    model may have added despite instructions not to.
    """
    text = strip_markdown_fences(raw_text)

    start = text.find("[")
    if start == -1:
        raise ValueError(
            "No JSON array ('[') was found anywhere in the model's response."
        )

    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]

    raise ValueError(
        "Found an opening '[' but no matching closing ']' -- the model's "
        "response was likely truncated."
    )


def normalize_slides(raw_slides: List[dict]) -> List[dict]:
    """Coerce a loosely-typed list of dicts into the strict slide schema,
    renumbering sequentially and padding/trimming bullets to exactly 3."""
    normalized = []
    for i, item in enumerate(raw_slides, start=1):
        if not isinstance(item, dict):
            continue

        title = str(item.get("title") or f"Slide {i}").strip()

        bullets = item.get("bullets") or []
        if isinstance(bullets, str):
            bullets = [bullets]
        elif not isinstance(bullets, list):
            bullets = [str(bullets)]
        bullets = [str(b).strip() for b in bullets if str(b).strip()]
        bullets = bullets[:3]
        while len(bullets) < 3:
            bullets.append("")

        visual_concept = str(
            item.get("visual_concept") or "A relevant supporting graphic."
        ).strip()

        normalized.append(
            {
                "slide_number": i,
                "title": title,
                "bullets": bullets,
                "visual_concept": visual_concept,
            }
        )

    if not normalized:
        raise ValueError(
            "The model's JSON parsed successfully but contained no usable "
            "slide objects."
        )
    return normalized


# ============================================================================
# LLM CALLS (Anthropic / OpenAI) FOR SLIDE STRUCTURING
# ============================================================================

def call_anthropic_for_slides(transcript: str, api_key: str) -> str:
    if not ANTHROPIC_SDK_AVAILABLE:
        raise RuntimeError(
            "The 'anthropic' package is not installed. Run: pip install anthropic"
        )

    client = Anthropic(api_key=api_key)
    response = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT_ANTHROPIC,
        messages=[
            {
                "role": "user",
                "content": (
                    f"TRANSCRIPT:\n\n{transcript}\n\n"
                    "Return ONLY the JSON array described in your instructions."
                ),
            }
        ],
    )
    text_blocks = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    if not text_blocks:
        raise ValueError("Anthropic response contained no text content blocks.")
    return "".join(text_blocks)


def call_openai_for_slides(transcript: str, api_key: str) -> str:
    if not OPENAI_SDK_AVAILABLE:
        raise RuntimeError(
            "The 'openai' package is not installed. Run: pip install openai"
        )

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=OPENAI_STRUCTURING_MODEL,
        response_format={"type": "json_object"},
        max_tokens=4096,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT_OPENAI},
            {"role": "user", "content": f"TRANSCRIPT:\n\n{transcript}"},
        ],
    )
    raw_content = response.choices[0].message.content
    if not raw_content:
        raise ValueError("OpenAI response contained no content.")

    try:
        parsed_obj = json.loads(raw_content)
    except json.JSONDecodeError as e:
        raise ValueError(f"OpenAI returned invalid JSON: {e}\n\nRaw response:\n{raw_content[:2000]}")

    slides = parsed_obj.get("slides")
    if slides is None:
        raise ValueError(
            "OpenAI's JSON object did not contain the expected 'slides' key. "
            f"Keys found: {list(parsed_obj.keys())}"
        )
    # Re-serialize so it flows through the same extraction/parsing path
    # used for the Anthropic response, keeping downstream logic unified.
    return json.dumps(slides)


def generate_slides(transcript: str, provider: str, api_key: str) -> List[dict]:
    if provider == "Anthropic (Claude)":
        raw_response_text = call_anthropic_for_slides(transcript, api_key)
    elif provider == "OpenAI (GPT-4o)":
        raw_response_text = call_openai_for_slides(transcript, api_key)
    else:
        raise ValueError(f"Unknown structuring provider: {provider}")

    json_str = extract_json_array(raw_response_text)

    try:
        raw_slides = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Malformed JSON from the model after extraction: {e}\n\n"
            f"Raw model response:\n{raw_response_text[:2000]}"
        )

    if not isinstance(raw_slides, list):
        raise ValueError("Expected a JSON array of slide objects, got a different type.")

    return normalize_slides(raw_slides)


# ============================================================================
# IMAGE GENERATION (scene visuals)
# ============================================================================

def build_image_prompt(slide: dict, style_name: str) -> str:
    style_suffix = STYLE_PRESETS.get(style_name, "")
    prompt = (
        f"{slide['visual_concept']} "
        f"Style: {style_suffix}. "
        "No text, captions, words, letters, or watermarks in the image."
    )
    return prompt


def generate_scene_image(slide: dict, style_name: str, api_key: str) -> str:
    """Generate one scene image and return it as a base64-encoded PNG string.

    Tries gpt-image-1 first; falls back to dall-e-3 for API keys/orgs that
    don't have gpt-image-1 access.
    """
    if not OPENAI_SDK_AVAILABLE:
        raise RuntimeError(
            "The 'openai' package is not installed. Run: pip install openai"
        )

    client = OpenAI(api_key=api_key)
    prompt = build_image_prompt(slide, style_name)

    try:
        response = client.images.generate(
            model=IMAGE_MODEL_PRIMARY,
            prompt=prompt,
            size="1536x1024",
            quality="medium",
            n=1,
        )
        b64 = response.data[0].b64_json
        if b64:
            return b64
        raise ValueError("gpt-image-1 returned no image data.")
    except Exception:
        # Fall back to DALL-E 3 (different size/param surface). If this also
        # fails, let the exception propagate to the caller for display.
        response = client.images.generate(
            model=IMAGE_MODEL_FALLBACK,
            prompt=prompt,
            size="1792x1024",
            quality="standard",
            response_format="b64_json",
            n=1,
        )
        b64 = response.data[0].b64_json
        if not b64:
            raise ValueError("The image API returned no image data.")
        return b64


# ============================================================================
# ICON PICKER (fallback when a scene hasn't been visualized yet)
# ============================================================================

def pick_icon(*texts: str) -> str:
    combined = " ".join(texts).lower()
    for keywords, icon in ICON_RULES:
        if any(keyword in combined for keyword in keywords):
            return icon
    return DEFAULT_ICON


# ============================================================================
# RENDERING
# ============================================================================

def render_slide_card(slide: dict, total: int) -> None:
    title = html.escape(slide["title"])
    bullets_html = "".join(
        f'<li class="bullet-item">{html.escape(b)}</li>'
        for b in slide["bullets"]
        if b
    )
    visual_concept = html.escape(slide["visual_concept"])

    image_b64 = st.session_state.slide_images.get(slide["slide_number"])
    if image_b64:
        visual_html = f"""
        <img class="scene-image" src="data:image/png;base64,{image_b64}"
             alt="{visual_concept}" />
        <div class="visual-box">
            <div class="visual-icon">🎨</div>
            <div class="visual-copy">
                <div class="visual-label">SCENE</div>
                <div class="visual-text">{visual_concept}</div>
            </div>
        </div>
        """
    else:
        icon = pick_icon(slide["title"], slide["visual_concept"])
        visual_html = f"""
        <div class="visual-box">
            <div class="visual-icon">{icon}</div>
            <div class="visual-copy">
                <div class="visual-label">SCENE TO VISUALIZE</div>
                <div class="visual-text">{visual_concept}</div>
            </div>
        </div>
        """

    card_html = f"""
    <div class="slide-card">
        <span class="slide-badge">SLIDE {slide['slide_number']} OF {total}</span>
        <div class="slide-title">{title}</div>
        <ul class="bullet-list">
            {bullets_html}
        </ul>
        {visual_html}
    </div>
    """
    st.markdown(card_html, unsafe_allow_html=True)


def render_progress_dots(current_idx: int, total: int) -> None:
    dots = "".join(
        f'<span class="dot{" active" if i == current_idx else ""}"></span>'
        for i in range(total)
    )
    st.markdown(f'<div class="dots-container">{dots}</div>', unsafe_allow_html=True)


def render_presentation_mode(slides: List[dict], style_name: str, image_api_key: str) -> None:
    total = len(slides)
    idx = st.session_state.current_slide_idx
    idx = max(0, min(idx, total - 1))
    st.session_state.current_slide_idx = idx
    slide = slides[idx]

    render_slide_card(slide, total)

    if slide["slide_number"] not in st.session_state.slide_images:
        if st.button("🎨 Visualize this scene", key=f"visualize_{slide['slide_number']}"):
            if require_api_key(image_api_key, "OpenAI"):
                try:
                    with st.spinner("Painting this scene..."):
                        st.session_state.slide_images[slide["slide_number"]] = (
                            generate_scene_image(slide, style_name, image_api_key)
                        )
                    st.rerun()
                except Exception as e:  # noqa: BLE001 - surfaced to the user directly
                    st.session_state.last_error = traceback.format_exc()
                    st.error(f"Image generation failed: {e}")

    render_progress_dots(idx, total)

    nav_prev, nav_mid, nav_next = st.columns([1, 2, 1])
    with nav_prev:
        if st.button("← Previous", disabled=(idx == 0), use_container_width=True):
            st.session_state.current_slide_idx -= 1
            st.rerun()
    with nav_mid:
        jump_to = st.selectbox(
            "Jump to slide",
            options=list(range(1, total + 1)),
            index=idx,
            label_visibility="collapsed",
            key="jump_to_slide_select",
        )
        if jump_to - 1 != idx:
            st.session_state.current_slide_idx = jump_to - 1
            st.rerun()
    with nav_next:
        if st.button("Next →", disabled=(idx == total - 1), use_container_width=True):
            st.session_state.current_slide_idx += 1
            st.rerun()


def render_grid_overview(slides: List[dict]) -> None:
    cols_per_row = 3
    for row_start in range(0, len(slides), cols_per_row):
        row_slides = slides[row_start: row_start + cols_per_row]
        cols = st.columns(cols_per_row)
        for col, slide in zip(cols, row_slides):
            with col:
                image_b64 = st.session_state.slide_images.get(slide["slide_number"])
                image_html = (
                    f'<img class="grid-slide-image" src="data:image/png;base64,{image_b64}" />'
                    if image_b64
                    else ""
                )
                bullets_html = "".join(
                    f'<div class="grid-slide-bullet">• {html.escape(b)}</div>'
                    for b in slide["bullets"]
                    if b
                )
                card_html = f"""
                <div class="grid-slide-card">
                    {image_html}
                    <span class="grid-slide-badge">SLIDE {slide['slide_number']}</span>
                    <div class="grid-slide-title">{html.escape(slide['title'])}</div>
                    {bullets_html}
                </div>
                """
                st.markdown(card_html, unsafe_allow_html=True)
                if st.button("Open", key=f"open_slide_{slide['slide_number']}", use_container_width=True):
                    st.session_state.current_slide_idx = slide["slide_number"] - 1
                    st.rerun()


# ============================================================================
# MAIN APP
# ============================================================================

def main() -> None:
    init_session_state()
    inject_custom_css()

    # ---------------------------------------------------------------- HERO
    st.markdown(
        """
        <div class="app-hero">
            <span class="app-hero-badge">PROTOTYPE</span>
            <h1>🎙️ AudioSlides AI — Audiobook Visualizer</h1>
            <p>Turn an audiobook chapter, lecture, or podcast into a visual
            journey -- transcribed with Whisper, structured by an LLM into
            scenes, and illustrated with AI-generated images so you can
            actually <em>see</em> what the speaker is describing.</p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # ------------------------------------------------------------- SIDEBAR
    with st.sidebar:
        st.header("⚙️ Configuration")

        openai_api_key = st.text_input(
            "OpenAI API Key (Whisper + images)",
            value=os.environ.get("OPENAI_API_KEY", ""),
            type="password",
            key="openai_api_key_input",
            help="Used for Whisper transcription and scene image generation.",
        )

        st.divider()

        structuring_provider = st.radio(
            "Scene-structuring engine",
            options=["Anthropic (Claude)", "OpenAI (GPT-4o)"],
            key="structuring_provider",
        )

        if structuring_provider == "Anthropic (Claude)":
            anthropic_api_key = st.text_input(
                "Anthropic API Key",
                value=os.environ.get("ANTHROPIC_API_KEY", ""),
                type="password",
                key="anthropic_api_key_input",
                help="Used to call Claude to structure the transcript into scenes.",
            )
            structuring_key = anthropic_api_key
            structuring_label = "Anthropic"
        else:
            structuring_key = openai_api_key
            structuring_label = "OpenAI"
            st.caption("Reusing the OpenAI key above for GPT-4o structuring.")

        st.divider()

        art_style = st.selectbox(
            "🎨 Art style for scene images",
            options=list(STYLE_PRESETS.keys()),
            key="art_style_select",
            help="Applied to every generated scene so the deck feels like one continuous illustrated story.",
        )

        st.divider()
        st.caption(
            f"Whisper hard limit: **{MAX_FILE_SIZE_MB} MB** per file. "
            f"Supported formats: {', '.join(SUPPORTED_EXTENSIONS)}."
        )
        st.caption(
            "Scene images are generated on demand (per slide or all at "
            "once) -- each image is a separate, billable API call."
        )

        st.divider()
        if st.button("🔄 Start New Presentation", use_container_width=True):
            reset_deck_state()
            st.rerun()

    # ------------------------------------------------------------- STEP 1
    st.markdown('<span class="stage-label">STEP 1</span>', unsafe_allow_html=True)
    st.subheader("Upload audio & transcribe")

    uploaded_file = st.file_uploader(
        "Upload an MP3 / WAV / M4A file",
        type=SUPPORTED_EXTENSIONS,
    )

    if uploaded_file is not None and uploaded_file.name != st.session_state.last_uploaded_filename:
        # A genuinely new file was uploaded -- clear any previous deck so
        # stale slides aren't shown alongside a different transcript.
        reset_deck_state()
        st.session_state.last_uploaded_filename = uploaded_file.name

    transcribe_col, _ = st.columns([1, 3])
    with transcribe_col:
        transcribe_clicked = st.button(
            "🎧 Transcribe Audio",
            type="primary",
            use_container_width=True,
            disabled=uploaded_file is None,
        )

    if transcribe_clicked:
        file_error = validate_uploaded_file(uploaded_file)
        if file_error:
            st.error(file_error)
        elif not require_api_key(openai_api_key, "OpenAI"):
            pass
        else:
            try:
                with st.spinner("Transcribing audio with Whisper... this can take a minute for longer files."):
                    st.session_state.transcript = transcribe_audio(uploaded_file, openai_api_key)
                st.session_state.slides = None  # invalidate any old deck
                st.session_state.slide_images = {}
                st.session_state.current_slide_idx = 0
                st.success("Transcription complete.")
            except Exception as e:  # noqa: BLE001 - surfaced to the user directly
                st.session_state.last_error = traceback.format_exc()
                st.error(f"Transcription failed: {e}")

    if st.session_state.transcript:
        with st.expander("📄 View / verify transcript", expanded=False):
            st.text_area(
                "Transcript",
                value=st.session_state.transcript,
                height=240,
                disabled=True,
                label_visibility="collapsed",
            )
            st.download_button(
                "Download transcript (.txt)",
                data=st.session_state.transcript,
                file_name="transcript.txt",
                mime="text/plain",
            )

    # ------------------------------------------------------------- STEP 2
    st.divider()
    st.markdown('<span class="stage-label">STEP 2</span>', unsafe_allow_html=True)
    st.subheader("Break the audio into visual scenes")

    generate_col, _ = st.columns([1, 3])
    with generate_col:
        generate_clicked = st.button(
            "✨ Generate Scenes",
            type="primary",
            use_container_width=True,
            disabled=not st.session_state.transcript,
        )

    if generate_clicked:
        if not require_api_key(structuring_key, structuring_label):
            pass
        else:
            try:
                with st.spinner(f"Structuring scenes with {structuring_provider}..."):
                    st.session_state.slides = generate_slides(
                        st.session_state.transcript,
                        structuring_provider,
                        structuring_key,
                    )
                st.session_state.slide_images = {}
                st.session_state.current_slide_idx = 0
                st.success(f"Generated {len(st.session_state.slides)} scenes.")
            except Exception as e:  # noqa: BLE001 - surfaced to the user directly
                st.session_state.last_error = traceback.format_exc()
                st.error(f"Scene generation failed: {e}")

    if st.session_state.last_error:
        with st.expander("🐛 Debug details (last error)", expanded=False):
            st.code(st.session_state.last_error)

    # ------------------------------------------------------------- STEP 3
    if st.session_state.slides:
        slides = st.session_state.slides
        st.divider()
        st.markdown('<span class="stage-label">STEP 3</span>', unsafe_allow_html=True)
        st.subheader("Illustrate the scenes")

        pending = [s for s in slides if s["slide_number"] not in st.session_state.slide_images]
        done = len(slides) - len(pending)
        st.caption(
            f"{done} of {len(slides)} scenes illustrated · style: **{art_style}** · "
            "generate them all below, or one at a time as you click through the deck."
        )

        illustrate_col, _ = st.columns([1, 3])
        with illustrate_col:
            illustrate_all_clicked = st.button(
                f"🎨 Illustrate all {len(pending)} remaining scenes" if pending else "✅ All scenes illustrated",
                type="primary",
                use_container_width=True,
                disabled=not pending,
            )

        if illustrate_all_clicked and pending:
            if require_api_key(openai_api_key, "OpenAI"):
                progress = st.progress(0.0)
                failures = 0
                for n, slide in enumerate(pending, start=1):
                    try:
                        with st.spinner(f"Painting scene {slide['slide_number']} of {len(slides)}..."):
                            st.session_state.slide_images[slide["slide_number"]] = (
                                generate_scene_image(slide, art_style, openai_api_key)
                            )
                    except Exception as e:  # noqa: BLE001 - surfaced to the user directly
                        failures += 1
                        st.session_state.last_error = traceback.format_exc()
                        st.warning(f"Scene {slide['slide_number']} failed: {e}")
                    progress.progress(n / len(pending))
                progress.empty()
                if failures:
                    st.warning(
                        f"Illustrated {len(pending) - failures} scenes; {failures} failed. "
                        "You can retry failed scenes individually in the deck below."
                    )
                else:
                    st.success("All scenes illustrated.")
                st.rerun()

    # ------------------------------------------------------------- STEP 4
    if st.session_state.slides:
        slides = st.session_state.slides
        st.divider()
        st.markdown('<span class="stage-label">STEP 4</span>', unsafe_allow_html=True)
        header_col, toggle_col, download_col = st.columns([2, 2, 2])
        with header_col:
            st.subheader("Your visual deck")
        with toggle_col:
            view_mode = st.radio(
                "View",
                options=["Presentation", "Grid overview"],
                horizontal=True,
                label_visibility="collapsed",
                key="view_mode",
            )
        with download_col:
            st.download_button(
                "⬇️ Download slides (.json)",
                data=json.dumps(slides, indent=2),
                file_name="slides.json",
                mime="application/json",
                use_container_width=True,
            )

        if view_mode == "Presentation":
            render_presentation_mode(slides, art_style, openai_api_key)
        else:
            render_grid_overview(slides)

    with st.expander("ℹ️ How this works", expanded=False):
        st.markdown(
            """
            1. **Transcription** -- your audio file is sent to OpenAI's
               Whisper API (`whisper-1`) and converted to plain text.
            2. **Scene structuring** -- the transcript is sent to an LLM
               (Claude or GPT-4o) with a strict system prompt that forces a
               JSON array of scene objects (`title`, `bullets`,
               `visual_concept`). Each `visual_concept` is written as a
               concrete, paintable scene description.
            3. **Illustration** -- each scene description is sent to OpenAI's
               image API (`gpt-image-1`, falling back to `dall-e-3`) with
               your chosen art style appended, so the whole deck reads like
               one continuous illustrated story.
            4. **Rendering** -- the JSON is validated and normalized (missing
               fields are filled in, bullets are padded/trimmed to exactly
               three), then rendered as styled slide cards you can click
               through like a real deck.

            **On "production-ready":** this file is a clean, defensively
            coded prototype -- input validation, JSON repair, and error
            handling are all in place. Turning it into a full multi-tenant
            SaaS product would still mean adding auth, a persistent database
            for saved decks and images, a background job queue for long
            transcriptions and batch illustration, and usage-based billing,
            none of which fit inside a single Streamlit script.
            """
        )


if __name__ == "__main__":
    main()

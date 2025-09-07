# Quickstart

```bash
pnpm i
cp .env.example .env
make dev
```

Cool. Make the repo and stop overthinking the “pitches.” Pitch/energy alone will betray you the minute two people get excited at the same time. Use **speaker embeddings** to fingerprint voices, and keep your “most-present pitches” trick as a dumb first-pass feature, not the core.

Here’s a tight, buildable plan that fits your stack (Next.js + AWS) and lets you ship an MVP fast.

# Monorepo layout (pnpm + Turbo)

```
multi-combo/
  apps/
    web/                # Next.js UI (PTT, meters, labels)
    router/             # Node/TS API + WebSocket, session state
  services/
    audio-worker/       # Python: diarization + embeddings + pitch heuristic
  packages/
    proto/              # shared TS types
  infra/
    docker/             # Dockerfiles, compose for local
    terraform/          # AWS: API GW, Lambda/ECS, S3, ElastiCache
```

# What actually identifies the speaker

1. **Enrollment (optional but clutch):** record 20–30 s per person, build an embedding vector per user.
2. **Live pipeline per chunk:**

   * VAD → segment speech
   * Embedding model (ECAPA-TDNN or x-vector) → vector
   * **Cosine similarity** against enrolled vectors
   * If no enrollment: in-session clustering to S1/S2/S3, then map to A/B/C once
3. **Cheap heuristic (your idea):**

   * Extract **pitch (f0)** + **loudness (RMS)** + **formants**.
   * Use it only to break ties or when embeddings confidence is low.

# Services: responsibilities

**web (Next.js)**

* Push-to-talk buttons per user (A/B/C), mic capture via WebRTC
* Show live meters and the label the router returns

**router (Node/TypeScript)**

* WebSocket for low-latency chunks from web
* Buffers chunks per “candidate speaker”
* Calls `audio-worker` for diarization/embedding
* Maintains per-speaker rolling context + a group summary
* Calls your LLM with a system prompt that forbids context mixing
* Stores logs in Postgres; session state in Redis

**audio-worker (Python)**

* VAD (Silero/WebRTC VAD)
* Embeddings (SpeechBrain ECAPA pre-trained)
* Optional diarization (pyannote) when there’s crosstalk
* Pitch/energy extraction (praat-parselmouth or librosa)
* Returns `{speaker_id, confidence, f0_mean, rms, alt_label_if_low_conf}`

# Minimal code you can drop in today

**services/audio-worker/app.py**

```python
from fastapi import FastAPI, UploadFile
from pydantic import BaseModel
import torch, librosa, numpy as np
from speechbrain.pretrained import EncoderClassifier
import uvicorn, io, soundfile as sf

app = FastAPI()
model = EncoderClassifier.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb", run_opts={"device":"cpu"}
)

enrolled = {}  # user_id -> embedding np.array

...
```

Further setup details are tracked in PR #4.

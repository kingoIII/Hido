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
* If using one device for multiple people, hard-label with the pressed PTT

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

def wav_to_np(file: UploadFile):
    raw = io.BytesIO(file.file.read())
    y, sr = sf.read(raw, dtype='float32')
    if y.ndim > 1: y = np.mean(y, axis=1)
    return y, sr

def embed(y, sr):
    tensor = torch.tensor(y).unsqueeze(0)
    with torch.no_grad():
        emb = model.encode_batch(tensor).squeeze(0).squeeze(0).cpu().numpy()
    return emb / np.linalg.norm(emb)

def pitch_energy(y, sr):
    f0 = librosa.yin(y, fmin=50, fmax=400, sr=sr)
    rms = librosa.feature.rms(y=y).mean()
    return float(np.nanmean(f0)), float(rms)

@app.post("/enroll/{user_id}")
async def enroll(user_id: str, file: UploadFile):
    y, sr = wav_to_np(file)
    enrolled[user_id] = embed(y, sr)
    return {"ok": True}

class InferResp(BaseModel):
    label: str
    confidence: float
    f0_mean: float
    rms: float

@app.post("/infer", response_model=InferResp)
async def infer(file: UploadFile):
    y, sr = wav_to_np(file)
    e = embed(y, sr)
    scores = {u: float(np.dot(e, v)) for u,v in enrolled.items()}
    if scores:
        label, conf = max(scores.items(), key=lambda kv: kv[1])
    else:
        label, conf = "S?", 0.0
    f0, rms = pitch_energy(y, sr)
    return {"label": label, "confidence": conf, "f0_mean": f0, "rms": rms}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

**apps/router/src/index.ts**

```ts
import express from "express";
import fetch from "node-fetch";
import Redis from "ioredis";

const r = new Redis(process.env.REDIS_URL!);
const app = express();
app.use(express.json({ limit: "5mb" }));

type Turn = { userHint?: string; chunkUrl: string; sessionId: string };

app.post("/route", async (req, res) => {
  const { userHint, chunkUrl, sessionId } = req.body as Turn;

  // send audio to audio-worker
  const audio = await fetch(chunkUrl);
  const blob = await audio.arrayBuffer();
  const form = new FormData();
  form.append("file", new Blob([blob]), "a.wav");
  const resp = await fetch(process.env.AUDIO_WORKER_URL + "/infer", { method: "POST", body: form as any });
  const { label, confidence, f0_mean, rms } = await resp.json();

  const finalLabel = userHint ?? (confidence > 0.55 ? label : "unknown");
  await r.lpush(`sess:${sessionId}:turns:${finalLabel}`, JSON.stringify({ ts: Date.now(), chunkUrl, f0_mean, rms }));
  res.json({ speaker: finalLabel, confidence, f0_mean, rms });
});

app.listen(8080, () => console.log("router up"));
```

**apps/web:** capture audio in chunks, upload to S3, POST `/route` with `chunkUrl` and optional `userHint` from PTT A/B/C.

# Why your “most important pitches” idea still matters

Keep it as a **tie-breaker** and for **UI feedback**:

* Show per-speaker average f0 and loudness so users can see why the system decided A vs B.
* If embeddings confidence < threshold, fall back to “closest f0 profile this session,” but mark it as low-confidence and ask for PTT.

# Data you need (not huge)

* 30 s enrollment per speaker
* A few minutes of messy overlapped talk to test diarization
* Log every mislabel and keep the short clip; that becomes your fine-tuning set if needed

# Local dev spin-up

```
pnpm i
docker compose up -d   # redis + audio-worker
pnpm --filter router dev
pnpm --filter web dev
```

# Guardrails that save you pain

* Force PTT when confidence drops or two people talk at once
* Cap history: 20 turns per user, 60 group, summarize the rest
* Never mix contexts in the LLM prompt; label sections per user in the reply

Ship this as an MVP. If you still crave the “pitches only” fantasy after that, toggle off embeddings and enjoy the chaos.

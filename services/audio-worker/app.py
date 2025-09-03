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

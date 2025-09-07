import express from 'express';
import fetch from 'node-fetch';
import Redis from 'ioredis';
import FormData from 'form-data';

const r = new Redis(process.env.REDIS_URL!);
const app = express();
app.use(express.json({ limit: '5mb' }));

type Turn = { userHint?: string; chunkUrl: string; sessionId: string };
interface WorkerResp {
  label: string;
  confidence: number;
  f0_mean: number;
  rms: number;
}

app.post('/route', async (req: express.Request, res: express.Response) => {
  const { userHint, chunkUrl, sessionId } = req.body as Turn;

  const audio = await fetch(chunkUrl);
  const blob = await audio.arrayBuffer();
  const form = new FormData();
  form.append('file', Buffer.from(blob), { filename: 'a.wav' });
  const resp = await fetch(`${process.env.AUDIO_WORKER_URL}/infer`, {
    method: 'POST',
    body: form as unknown as import('node-fetch').BodyInit,
  });
  const { label, confidence, f0_mean, rms } = (await resp.json()) as WorkerResp;

  const finalLabel = userHint ?? (confidence > 0.55 ? label : 'unknown');
  await r.lpush(
    `sess:${sessionId}:turns:${finalLabel}`,
    JSON.stringify({ ts: Date.now(), chunkUrl, f0_mean, rms })
  );

  res.json({ speaker: finalLabel, confidence, f0_mean, rms });
});

app.listen(8080, () => console.log('router up'));

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import Redis from "ioredis";

const r = new Redis(process.env.REDIS_URL!);
const app = express();
app.get("/health", (_, res) => res.send("ok"));

interface InMsg {
  sessionId: string;
  userHint?: string;
  chunk: string; // base64 encoded audio
}

interface WorkerResp {
  label: string;
  confidence: number;
  f0_mean: number;
  rms: number;
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/route" });

wss.on("connection", ws => {
  ws.on("message", async raw => {
    try {
      const { sessionId, userHint, chunk } = JSON.parse(raw.toString()) as InMsg;
      const buf = Buffer.from(chunk, "base64");
      const form = new FormData();
      form.append("file", new Blob([buf]), "a.wav");
      const resp = await fetch(process.env.AUDIO_WORKER_URL + "/infer", { method: "POST", body: form });
      const { label, confidence, f0_mean, rms } = (await resp.json()) as WorkerResp;
      const finalLabel = userHint ?? (confidence > 0.55 ? label : "unknown");
      await r.lpush(
        `sess:${sessionId}:turns:${finalLabel}`,
        JSON.stringify({ ts: Date.now(), f0_mean, rms })
      );
      ws.send(JSON.stringify({ speaker: finalLabel, confidence, f0_mean, rms }));
    } catch (err) {
      ws.send(JSON.stringify({ error: "processing_failed" }));
    }
  });
});

server.listen(8080, () => console.log("router ws up"));

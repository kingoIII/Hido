import { useEffect, useRef, useState } from 'react';

export default function Home() {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const activeRef = useRef<string | null>(null);
  const [label, setLabel] = useState('');
  const [confidence, setConfidence] = useState(0);
  const [level, setLevel] = useState(0);
  const sessionId = useRef(crypto.randomUUID());

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_ROUTER_WS || 'ws://localhost:8080/route';
    const ws = new WebSocket(wsUrl);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.speaker) {
        setLabel(msg.speaker);
        setConfidence(msg.confidence);
      }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRef.current = mr;
      mr.ondataavailable = async e => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && activeRef.current) {
          const buf = await e.data.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          bytes.forEach(b => binary += String.fromCharCode(b));
          const b64 = btoa(binary);
          wsRef.current.send(
            JSON.stringify({ sessionId: sessionId.current, userHint: activeRef.current, chunk: b64 })
          );
        }
      };

      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.sqrt(sum / data.length));
        requestAnimationFrame(tick);
      };
      tick();
    });
  }, []);

  const start = (hint: string) => {
    if (mediaRef.current && mediaRef.current.state === 'inactive') {
      activeRef.current = hint;
      mediaRef.current.start(1000);
    }
  };
  const stop = () => {
    if (mediaRef.current && mediaRef.current.state === 'recording') {
      mediaRef.current.stop();
      activeRef.current = null;
    }
  };

  return (
    <main style={{ padding: 20 }}>
      <h1>multi-combo</h1>
      <p>Hold a button while speaking.</p>
      <div style={{ display: 'flex', gap: 10 }}>
        {['A', 'B', 'C'].map(h => (
          <button
            key={h}
            onMouseDown={() => start(h)}
            onMouseUp={stop}
            onTouchStart={() => start(h)}
            onTouchEnd={stop}
          >
            {h}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 20, height: 10, background: '#eee', width: 200 }}>
        <div style={{ height: '100%', width: `${Math.min(1, level) * 200}px`, background: '#0a0' }} />
      </div>
      <p>
        Detected: {label || '—'} {label && `(${(confidence * 100).toFixed(1)}%)`}
      </p>
    </main>
  );
}

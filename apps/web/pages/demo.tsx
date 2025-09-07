import { useState } from 'react'
import { useSpeak } from '../components/useSpeak'

export default function DemoTTS() {
  const [input, setInput] = useState('')
  const [spoken, setSpoken] = useState('')

  useSpeak(spoken)

  return (
    <div style={{ padding: 40 }}>
      <h1>🗣 Speak Words Locally</h1>
      <p>Type something and hit speak. Browser will read it aloud.</p>

      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        style={{ padding: 8, fontSize: 16, marginRight: 10 }}
      />
      <button onClick={() => setSpoken(input)}>Speak</button>
    </div>
  )
}

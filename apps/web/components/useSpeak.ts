// useSpeak.ts — hook that reads text using browser TTS

import { useEffect, useRef } from 'react'

export function useSpeak(text: string | null) {
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null)

  useEffect(() => {
    if (!text) return

    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'en-US'
    utter.rate = 1.0
    utter.pitch = 1.0
    utter.volume = 1.0

    const voice = speechSynthesis
      .getVoices()
      .find(v => v.name.includes('Google') || v.lang === 'en-US')

    if (voice) utter.voice = voice

    synthRef.current = utter
    speechSynthesis.speak(utter)
  }, [text])
}

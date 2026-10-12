'use client'

/** Minimal typings for the Web Speech API (not in TypeScript's DOM lib). */
interface SpeechResultEvent {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

export interface SpeechSession {
  start(): void
  stop(): void
}

interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type RecognitionCtor = new () => RecognitionLike

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const isSpeechSupported = () => getCtor() !== null

/**
 * Starts dictation. `onFinalText` receives each finalised phrase; `onEnd` fires when listening
 * stops for any reason (including errors, which are reported through `onError` first).
 */
export function createSpeechSession(handlers: {
  onFinalText: (text: string) => void
  onError: (code: string) => void
  onEnd: () => void
}): SpeechSession | null {
  const Ctor = getCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = navigator.language || 'en-US'
  rec.continuous = true
  rec.interimResults = false
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]
      if (result?.isFinal) handlers.onFinalText(result[0].transcript.trim())
    }
  }
  rec.onerror = (e) => handlers.onError(e.error)
  rec.onend = handlers.onEnd
  return { start: () => rec.start(), stop: () => rec.stop() }
}

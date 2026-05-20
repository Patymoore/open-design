// Voice input via MediaRecorder + daemon-side Whisper transcription.
//
// Earlier we tried the browser's `webkitSpeechRecognition` API, but that
// path silently fails in OSS Electron — the constructor exists, the
// click resolves, and nothing comes back, because Chromium's binding
// requires Google's ASR API key (intentionally omitted from Electron).
// Paseo solves the same problem by recording locally and transcribing
// in its daemon via sherpa-onnx. We follow the same pattern but proxy
// to the user's existing OpenAI-compatible chat endpoint, so anyone
// with a working BYOK chat session already has working dictation —
// no extra config, no extra model download.
//
// Flow:
//   1. Click  → getUserMedia, start MediaRecorder, accumulate chunks
//   2. Click  → stop recorder, build Blob, POST to
//               `/api/proxy/openai/transcribe` with the user's chat
//               baseUrl + apiKey (read from the same localStorage the
//               BYOK chat proxy uses).
//   3. Daemon → forwards multipart to `<baseUrl>/audio/transcriptions`
//               with model=whisper-1, returns `{ text }`.
//   4. Hook   → calls `onCommit(text)` so the composer appends to draft.

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadConfig } from '../state/config';

type RecognitionStatus = 'idle' | 'recording' | 'transcribing' | 'error';

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  // Prefer opus in a webm container — every modern Chromium supports it
  // and OpenAI's Whisper API accepts it. Fall back to ogg/opus, then any
  // recorder default. Sniff in order so we pick the most universal one
  // the runtime is willing to give us.
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export function isVoiceInputAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export interface UseVoiceInputOptions {
  // BCP-47 language tag forwarded to Whisper. Defaults to the user's
  // browser language so Chinese users get zh + English users get en
  // out of the box without any extra setting.
  lang?: string;
  onCommit: (text: string) => void;
  onInterim?: (text: string) => void;
}

export interface UseVoiceInputApi {
  status: RecognitionStatus;
  available: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  errorMessage: string | null;
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputApi {
  const { onCommit, lang } = options;
  const onCommitRef = useRef(onCommit);
  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<RecognitionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      // Tear down the recorder + mic stream if the host unmounts while
      // we are still capturing; without this the OS keeps the mic-in-use
      // indicator on indefinitely.
      try {
        recorderRef.current?.stop();
      } catch {
        // ignore
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  async function transcribe(blob: Blob): Promise<string> {
    const config = loadConfig();
    const baseUrl = (config.apiProviderBaseUrl || config.baseUrl || '').trim();
    const apiKey = (config.apiKey || '').trim();
    if (!baseUrl || !apiKey) {
      throw new Error(
        'Voice input needs a BYOK chat config (baseUrl + apiKey) — open Settings → API to configure.',
      );
    }
    const form = new FormData();
    // OpenAI Whisper requires a recognizable file extension; webm is what
    // MediaRecorder gives us by default in Chromium.
    const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
    form.set('audio', blob, `dictation.${ext}`);
    form.set('baseUrl', baseUrl);
    form.set('apiKey', apiKey);
    form.set('model', 'whisper-1');
    if (lang) form.set('language', lang);
    const resp = await fetch('/api/proxy/openai/transcribe', {
      method: 'POST',
      body: form,
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => null);
      const msg = body?.error?.message ?? `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    const data = (await resp.json()) as { text?: string };
    return (data.text ?? '').trim();
  }

  const stop = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (!isVoiceInputAvailable()) {
      setErrorMessage('Voice input is not available in this browser.');
      setStatus('error');
      return;
    }
    if (status === 'recording' || status === 'transcribing') return;
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickAudioMimeType();
      const rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onerror = (ev: Event) => {
        setErrorMessage(
          (ev as ErrorEvent).message ?? 'Recorder error',
        );
        setStatus('error');
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: mimeType || chunksRef.current[0]?.type || 'audio/webm',
        });
        chunksRef.current = [];
        if (blob.size === 0) {
          setStatus('idle');
          return;
        }
        setStatus('transcribing');
        try {
          const text = await transcribe(blob);
          if (text.length > 0) {
            onCommitRef.current(text);
          }
          setStatus('idle');
        } catch (err) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      };

      rec.start();
      setStatus('recording');
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : '麦克风权限被拒绝或不可用',
      );
      setStatus('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, lang]);

  const toggle = useCallback(() => {
    if (status === 'recording') {
      stop();
    } else if (status !== 'transcribing') {
      void start();
    }
  }, [status, start, stop]);

  return {
    status,
    available: isVoiceInputAvailable(),
    start: () => void start(),
    stop,
    toggle,
    errorMessage,
  };
}

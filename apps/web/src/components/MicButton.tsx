// Small mic toggle that wraps `useVoiceInput`. Drops into either the
// home composer or the project chat composer — both pass a callback
// that appends committed transcripts to the draft, plus an optional
// interim callback to show a ghost preview while the user is still
// speaking. The button itself is purely presentational; recognition
// state lives in the hook.

import { useEffect } from 'react';
import { Icon } from './Icon';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface Props {
  // Called with each committed (final) utterance chunk. The host
  // typically appends ` ${text}` to its draft state.
  onCommit: (text: string) => void;
  // Called with the latest interim transcript so the host can render
  // a ghost overlay. Passing nothing is fine — the committed text
  // alone is the primary surface.
  onInterim?: (text: string) => void;
  // Optional BCP-47 language tag override. Defaults to navigator.language.
  lang?: string;
  className?: string;
  title?: string;
}

export function MicButton({
  onCommit,
  onInterim,
  lang,
  className,
  title,
}: Props) {
  const voice = useVoiceInput({ onCommit, onInterim, lang });

  // Stop recognition if the button unmounts mid-utterance so the
  // browser doesn't keep the mic open after the composer closes.
  useEffect(() => {
    return () => {
      voice.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!voice.available) {
    // Render a disabled stub so layout stays predictable. Most modern
    // Chromium-based shells support webkitSpeechRecognition; this
    // branch protects Safari + Firefox.
    return null;
  }

  const recording = voice.status === 'recording';
  const transcribing = voice.status === 'transcribing';
  const errored = voice.status === 'error';
  const label = recording
    ? '停止录音'
    : transcribing
      ? '正在识别…'
      : '开始语音输入';

  return (
    <button
      type="button"
      className={`mic-btn${recording ? ' mic-btn-active' : ''}${
        transcribing ? ' mic-btn-busy' : ''
      }${errored ? ' mic-btn-error' : ''}${
        className ? ` ${className}` : ''
      }`}
      data-testid="mic-button"
      aria-label={label}
      aria-pressed={recording}
      title={
        title ?? (errored && voice.errorMessage
          ? voice.errorMessage
          : label)
      }
      onClick={voice.toggle}
      disabled={transcribing}
    >
      <Icon name={transcribing ? 'spinner' : 'mic'} size={14} />
      {recording ? <span className="mic-btn-pulse" aria-hidden /> : null}
    </button>
  );
}

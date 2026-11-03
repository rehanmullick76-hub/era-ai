import { useEffect, useRef, useState } from "react";

interface SpeechRecognitionResult {
  isFinal: boolean;
  0?: { transcript?: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export function appendRecognizedText(current: string, transcript: string): string {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return current;
  const separator = current && !/\s$/.test(current) ? " " : "";
  return `${current}${separator}${cleanTranscript}`;
}

export function isSpeechRecognitionAbort(error: string): boolean {
  return error === "aborted";
}

export function useSpeechInput(onTranscript: (transcript: string) => void, disabled = false) {
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  const disabledRef = useRef(disabled);
  const ignoreResultsRef = useRef(false);
  onTranscriptRef.current = onTranscript;
  disabledRef.current = disabled;

  useEffect(() => {
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    setIsSupported(Boolean(Recognition));
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = event => {
      if (disabledRef.current || ignoreResultsRef.current) return;
      const transcripts: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result?.isFinal ? result[0]?.transcript?.trim() : "";
        if (text) transcripts.push(text);
      }
      const transcript = transcripts.join(" ");
      if (transcript.trim()) onTranscriptRef.current(transcript);
    };
    recognition.onerror = event => {
      if (isSpeechRecognitionAbort(event.error)) {
        setIsListening(false);
        return;
      }
      setError(event.error || "recognition-failed");
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!disabled) return;
    const recognition = recognitionRef.current;
    if (!recognition || !isListening) return;
    ignoreResultsRef.current = true;
    try {
      recognition.stop();
    } catch {
      // A stop after browser-side termination is already complete.
    }
    setIsListening(false);
  }, [disabled, isListening]);

  const toggleListening = () => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError("unsupported");
      return;
    }

    setError(null);
    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }

    try {
      ignoreResultsRef.current = false;
      recognition.start();
      setIsListening(true);
    } catch {
      setError("recognition-failed");
      setIsListening(false);
    }
  };

  return { isSupported, isListening, error, toggleListening };
}

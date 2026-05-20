import { useCallback, useEffect, useRef, useState } from "react";

type RecorderState = "idle" | "recording" | "stopped" | "error";

export type RecorderHook = {
  state: RecorderState;
  duration: number; // seconds
  blob: Blob | null;
  url: string | null;
  mimeType: string | null;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
};

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

export function useRecorder(): RecorderHook {
  const [state, setState] = useState<RecorderState>("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      if (url) URL.revokeObjectURL(url);
    };
  }, [cleanup, url]);

  const start = useCallback(async () => {
    try {
      setError(null);
      if (url) {
        URL.revokeObjectURL(url);
        setUrl(null);
      }
      setBlob(null);
      setDuration(0);
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mt = pickMimeType();
      setMimeType(mt ?? null);
      const recorder = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const finalType = recorder.mimeType || mt || "audio/webm";
        const finalBlob = new Blob(chunksRef.current, { type: finalType });
        const finalUrl = URL.createObjectURL(finalBlob);
        setBlob(finalBlob);
        setUrl(finalUrl);
        setState("stopped");
        cleanup();
      };
      recorder.start();
      startTimeRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        setDuration((Date.now() - startTimeRef.current) / 1000);
      }, 200);
      setState("recording");
    } catch (err) {
      setError((err as Error).message);
      setState("error");
      cleanup();
    }
  }, [cleanup, url]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const reset = useCallback(() => {
    if (url) URL.revokeObjectURL(url);
    cleanup();
    setBlob(null);
    setUrl(null);
    setMimeType(null);
    setError(null);
    setDuration(0);
    setState("idle");
  }, [cleanup, url]);

  return { state, duration, blob, url, mimeType, error, start, stop, reset };
}

import { useEffect, useRef, useState } from "react";
export function useAudio(running: boolean, cue: string) {
  const [metronome, setMetronome] = useState(false);
  const [voice, setVoice] = useState(false);
  const [localVoice, setLocalVoice] = useState<SpeechSynthesisVoice | null>(
    null,
  );
  const [audioError, setAudioError] = useState("");
  const context = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const update = () =>
      setLocalVoice(
        speechSynthesis
          .getVoices()
          .find((v) => v.localService && /^en\b/i.test(v.lang)) ?? null,
      );
    update();
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", update);
      speechSynthesis.cancel();
    };
  }, []);
  useEffect(() => {
    if (!metronome || !running || !context.current) return;
    const ctx = context.current;
    let next = ctx.currentTime + 0.05;
    const schedule = () => {
      while (next < ctx.currentTime + 0.1) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.frequency.value = 800;
        gain.gain.setValueAtTime(0.0001, next);
        gain.gain.exponentialRampToValueAtTime(0.12, next + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, next + 0.045);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(next);
        oscillator.stop(next + 0.05);
        next += 60 / 110;
      }
    };
    schedule();
    const timer = window.setInterval(schedule, 25);
    return () => {
      clearInterval(timer);
      void ctx.suspend();
    };
  }, [metronome, running]);
  useEffect(() => {
    if (metronome && running) void context.current?.resume();
  }, [metronome, running]);
  useEffect(() => {
    if (!voice || !running || !localVoice) {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      return;
    }
    // Delay changes to avoid a stream of speech when tracking flickers.
    const timer = setTimeout(() => {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(cue);
      utterance.voice = localVoice;
      utterance.lang = localVoice.lang;
      utterance.rate = 0.94;
      utterance.onerror = () => setVoice(false);
      speechSynthesis.speak(utterance);
    }, 1200);
    return () => {
      clearTimeout(timer);
      speechSynthesis.cancel();
    };
  }, [voice, running, cue, localVoice]);
  useEffect(
    () => () => {
      void context.current?.close();
    },
    [],
  );
  const toggleMetronome = async () => {
    try {
      if (!context.current) context.current = new AudioContext();
      await context.current.resume();
      setMetronome((v) => !v);
      setAudioError("");
    } catch {
      setAudioError(
        "Audio is unavailable in this browser. Follow the on-screen rate.",
      );
      setMetronome(false);
    }
  };
  return {
    metronome,
    toggleMetronome,
    voice,
    toggleVoice: () => setVoice((v) => !v),
    voiceAvailable: !!localVoice,
    audioError,
  };
}

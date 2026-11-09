import { useEffect, useRef, useState } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { summarizeSession } from "../mcp/logic";
import {
  AgentAccess,
  Footer,
  Gauge,
  Icon,
  PosePreview,
  SetupDiagram,
} from "./components";
import {
  downloadResult,
  importPractice,
  LivePractice,
  loadPose,
  type ExportResult,
  type LiveState,
  type Source,
} from "./runtime";
import { useAudio } from "./audio";
import { coachingCue } from "../src/coaching";

type Stage = "welcome" | "setup" | "practice" | "importing" | "results";
const initialLive: LiveState = { snapshot: null, landmarks: [], elapsed: 0 };
const time = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, "0")}`;
const number = (value: number | null | undefined, digits = 0, suffix = "") =>
  value == null ? "—" : `${value.toFixed(digits)}${suffix}`;
const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value * 100)}%`;
export default function App() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [source, setSource] = useState<Source>("demo");
  const [live, setLive] = useState<LiveState>(initialLive);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const runner = useRef<LivePractice | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const pose = useRef<PoseLandmarker | null>(null);
  const controller = useRef<AbortController | null>(null);
  const cameraMount = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const s = live.snapshot;
  const rate =
    paused || s?.missingLandmarks ? null : (s?.recentRateCpm ?? null);
  const label = paused
    ? "Paused"
    : s?.missingLandmarks
      ? "Tracking unavailable"
      : rate === null
        ? "Finding your rhythm"
        : rate < 100
          ? "Below target"
          : rate > 120
            ? "Above target"
            : "On target";
  const cue = coachingCue(s, paused);
  const audio = useAudio(stage === "practice" && !paused, cue);
  const cleanup = () => {
    controller.current?.abort();
    controller.current = null;
    runner.current?.dispose();
    runner.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) {
      video.current.pause();
      video.current.srcObject = null;
      video.current.remove();
      video.current = null;
    }
    pose.current?.close();
    pose.current = null;
  };
  useEffect(() => () => cleanup(), []);
  useEffect(() => {
    title.current?.focus();
  }, [stage]);
  useEffect(() => {
    if (cameraReady && video.current && cameraMount.current)
      cameraMount.current.appendChild(video.current);
  }, [cameraReady, stage]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden && stage === "practice" && !paused) {
        runner.current?.pause();
        setPaused(true);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [stage, paused]);
  const home = () => {
    cleanup();
    setLoading("");
    setError("");
    setCameraReady(false);
    setConfirmed(false);
    setStage("welcome");
  };
  const complete = (value: ExportResult) => {
    cleanup();
    setResult(value);
    setStage("results");
    setLoading("");
    setPaused(false);
  };
  const start = (input: "demo" | "camera") => {
    if (input === "demo") cleanup();
    setSource(input);
    setResult(null);
    setLive(initialLive);
    setError("");
    setLoading("");
    setPaused(false);
    setStage("practice");
    runner.current = new LivePractice(
      input,
      video.current,
      pose.current,
      setLive,
      complete,
      (message) => {
        setError(
          `Tracking stopped: ${message} End this practice or try resuming.`,
        );
        setPaused(true);
      },
    );
    runner.current.start();
  };
  const prepareCamera = async () => {
    cleanup();
    setError("");
    setCameraReady(false);
    setLoading("Waiting for camera permission…");
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs HTTPS or localhost and a supported browser.",
        );
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      if (abort.signal.aborted) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const element = document.createElement("video");
      element.muted = true;
      element.playsInline = true;
      element.autoplay = true;
      element.srcObject = media;
      video.current = element;
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer);
          element.onloadeddata = null;
          element.onerror = null;
          abort.signal.removeEventListener("abort", cancel);
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                "Camera did not provide a frame. Check that another app is not using it.",
              ),
            ),
          15000,
        );
        const cancel = () =>
          finish(new DOMException("Cancelled", "AbortError"));
        element.onloadeddata = () => finish();
        element.onerror = () => finish(new Error("Camera could not start."));
        abort.signal.addEventListener("abort", cancel, { once: true });
        void element.play().catch((e) => finish(e));
      });
      setLoading("Loading pose model from Google…");
      const model = await loadPose(abort.signal);
      if (abort.signal.aborted) {
        model.close();
        return;
      }
      pose.current = model;
      setLoading("");
      setCameraReady(true);
      media.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (!abort.signal.aborted) {
          runner.current?.pause();
          setPaused(true);
          setCameraReady(false);
          setError(
            "Camera disconnected. End the practice and reconnect your camera to try again.",
          );
        }
      });
    } catch (e) {
      if (abort.signal.aborted) return;
      cleanup();
      setLoading("");
      const message =
        e instanceof Error ? e.message : "Camera or model could not start.";
      setError(
        `Camera unavailable. ${message} Check permissions and your connection, then retry. You can also try the demo without a camera.`,
      );
    }
  };
  const importFile = async (file: File) => {
    cleanup();
    setSource("imported_video");
    setResult(null);
    setLive(initialLive);
    setError("");
    setStage("importing");
    setLoading("Loading pose model from Google…");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const model = await loadPose(abort.signal);
      if (abort.signal.aborted) {
        model.close();
        return;
      }
      pose.current = model;
      setLoading("Analyzing your video on this device…");
      const value = await importPractice(file, model, abort.signal, setLive);
      if (!abort.signal.aborted) complete(value);
    } catch (e) {
      if (abort.signal.aborted) return;
      cleanup();
      setLoading("");
      setStage("welcome");
      setError(
        `Could not analyze this video. ${e instanceof Error ? e.message : "Please try again."} Try a playable MP4 or WebM, or use the demo. No video was uploaded.`,
      );
    }
  };
  const togglePause = () => {
    if (paused) {
      runner.current?.resume();
      setPaused(false);
    } else {
      runner.current?.pause();
      setPaused(true);
    }
  };
  const active = stage === "practice" || stage === "importing";
  const currentStep = stage === "results" ? 3 : active ? 2 : 1;
  const elbow =
    !paused &&
    s &&
    !s.missingLandmarks &&
    s.elbows.leftDeg !== null &&
    s.elbows.rightDeg !== null
      ? (s.elbows.leftDeg + s.elbows.rightDeg) / 2
      : null;

  return (
    <div className={`app stage-${stage}`}>
      <header className="site-header">
        <div className="brand">
          <span className="brand-icon">
            <Icon name="pulse" size={26} />
          </span>
          <div>
            <span className="brand-name">CPR Pace Coach</span>
            <span className="brand-caption">
              A little practice. A steadier rhythm.
            </span>
          </div>
        </div>
        <nav aria-label="Practice progress" className="steps">
          {["Get ready", "Practice", "Reflect"].map((step, i) => (
            <span
              key={step}
              className={
                currentStep === i + 1
                  ? "current"
                  : currentStep > i + 1
                    ? "done"
                    : ""
              }
              aria-current={currentStep === i + 1 ? "step" : undefined}
            >
              <b>
                {currentStep > i + 1 ? (
                  <Icon name="check" size={14} />
                ) : (
                  `0${i + 1}`
                )}
              </b>
              {step}
            </span>
          ))}
        </nav>
        <span className="privacy-tag">
          <Icon name="shield" size={16} />
          <span>On-device only</span>
        </span>
      </header>
      <main id="main">
        {error && (
          <div className="error-banner" role="alert">
            <Icon name="info" />
            <span>{error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setError("")}
            >
              <Icon name="close" />
            </button>
          </div>
        )}
        {stage === "welcome" && (
          <section className="welcome">
            <div className="welcome-copy">
              <span className="eyebrow">
                <span className="tiny-line" /> TWO MINUTES, JUST FOR PRACTICE
              </span>
              <h1 ref={title} tabIndex={-1}>
                Find your rhythm.
                <br />
                <span>Make it steady.</span>
              </h1>
              <p className="hero-description">
                A little guidance for your next CPR practice.
                <br className="desktop-break" /> Follow your pace, find a
                rhythm, and reflect.
              </p>
              <p className="first-step">
                New here? Start with <strong>Try demo</strong> to see how it
                works.
              </p>
              <button
                className="button primary demo-button"
                onClick={() => start("demo")}
              >
                <span className="button-leading">
                  <Icon name="play" /> Try demo
                </span>
                <span className="button-trailing">
                  No camera needed <Icon name="arrow" />
                </span>
              </button>
              <div className="entry-options">
                <button
                  className="button"
                  onClick={() => {
                    setStage("setup");
                    setError("");
                  }}
                >
                  <Icon name="camera" /> Start with camera
                </button>
                <button
                  className="button"
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="upload" /> Import a practice video
                </button>
              </div>
              <p className="free-note">
                <Icon name="shield" size={16} /> Free to use. Your video never
                leaves this device.
              </p>
              <div className="welcome-bottom">
                <span>
                  <b>02:00</b> per practice
                </span>
                <span>
                  <b>100–120</b> target /min
                </span>
                <span>
                  <b>No account</b> just begin
                </span>
              </div>
            </div>
            <div className="welcome-visual">
              <div className="visual-top">
                <span>
                  <span className="status-dot" /> A FOCUS ON PACE
                </span>
                <span>01 / PRACTICE</span>
              </div>
              <Gauge rate={110} label="A rhythm to aim for" preview />
              <div className="visual-bottom">
                <Icon name="pulse" size={20} />
                <span>A target preview, not a measurement.</span>
              </div>
            </div>
            <div className="welcome-method">
              <span className="method-index">THE PRACTICE LOOP</span>
              <div>
                <b>01</b>
                <p>
                  <strong>Set your space</strong>
                  <span>A cushion or manikin. A stable camera.</span>
                </p>
              </div>
              <div>
                <b>02</b>
                <p>
                  <strong>Follow your pace</strong>
                  <span>Simple visual cues, optional sound.</span>
                </p>
              </div>
              <div>
                <b>03</b>
                <p>
                  <strong>Take one thing forward</strong>
                  <span>A summary and a next practice goal.</span>
                </p>
              </div>
            </div>
          </section>
        )}
        {stage === "setup" && (
          <section className="setup section-width">
            <div className="section-heading">
              <span className="eyebrow">01 / GET READY</span>
              <h1 ref={title} tabIndex={-1}>
                Make a little room to practice.
              </h1>
              <p>Use a cushion or training manikin, never a person.</p>
            </div>
            <div className="setup-columns">
              <div className="setup-illustration">
                <SetupDiagram />
                <div className="setup-tip">
                  <Icon name="info" />
                  <p>
                    Place the camera to your side, slightly angled. Keep{" "}
                    <strong>both shoulders, elbows and wrists</strong> in frame.
                    A pure side view can hide one arm.
                  </p>
                </div>
              </div>
              <div className="setup-checklist">
                <div className="check-row">
                  <span>1</span>
                  <div>
                    <h3>Set the camera down</h3>
                    <p>
                      Keep it stable, with your upper body and arms visible in
                      good light.
                    </p>
                  </div>
                </div>
                <div className="check-row">
                  <span>2</span>
                  <div>
                    <h3>Allow camera access</h3>
                    <p>
                      Video is processed on this device and is never uploaded.
                      The pose model downloads from Google once needed.
                    </p>
                  </div>
                </div>
                {cameraReady ? (
                  <div className="camera-check">
                    <div className="camera-mount" ref={cameraMount} />
                    <span>
                      <Icon name="check" size={16} /> Camera ready · check your
                      framing
                    </span>
                  </div>
                ) : (
                  <button
                    className="button"
                    disabled={!!loading}
                    onClick={prepareCamera}
                  >
                    <Icon name="camera" /> {loading || "Enable camera"}
                  </button>
                )}
                <label className="confirmation">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>
                    I have a cushion or manikin, and both arms are visible.
                  </span>
                </label>
                <button
                  className="button primary"
                  disabled={!cameraReady || !confirmed || !!loading}
                  onClick={() => start("camera")}
                >
                  <Icon name="play" /> Begin 2-minute practice
                </button>
                <div className="setup-alternatives">
                  <button className="text-button" onClick={() => start("demo")}>
                    Try demo instead <Icon name="arrow" size={16} />
                  </button>
                  <button className="text-button" onClick={home}>
                    Back
                  </button>
                </div>
              </div>
            </div>
            <p className="local-note" role="status">
              {loading ||
                "Free to use. No video, frames or pose coordinates leave your device."}
            </p>
          </section>
        )}
        {active && (
          <section className="practice">
            <h1 className="sr-only" ref={title} tabIndex={-1}>
              {stage === "importing"
                ? "Analyzing practice video"
                : "Two-minute practice"}
            </h1>
            <aside className="session-info">
              <span className="eyebrow">02 / RATE FOCUS</span>
              <h2>
                {stage === "importing" ? "Video analysis" : "Your practice"}
              </h2>
              <div className="session-badges">
                <span className={`badge ${source === "demo" ? "accent" : ""}`}>
                  {source === "demo"
                    ? "Simulated motion"
                    : source === "camera"
                      ? "Camera estimate"
                      : "Imported video"}
                </span>
                <span className="badge mobile-local">On-device only</span>
              </div>
              <div className="session-detail">
                <Icon name="clock" size={19} />
                <span>2-minute practice</span>
              </div>
              <p className="session-description">
                {source === "demo"
                  ? "Generated movement, processed by the same rhythm detector. No camera required."
                  : "Wrist motion gives an estimate of pace. Keep both arms in view."}
              </p>
              <span className="session-estimate">
                {source === "demo"
                  ? "Demo data · not a real measurement"
                  : "Practice estimates · not validated"}
              </span>
            </aside>
            <div className="timer-panel">
              <div>
                <Icon name="clock" size={19} />
                <strong>{time(live.elapsed)}</strong>
                <span>/ 02:00</span>
                <span className="remaining">
                  {time(Math.ceil((120000 - live.elapsed) / 1000) * 1000)} left
                </span>
              </div>
              <progress
                value={live.elapsed}
                max={120000}
                aria-label="Practice time elapsed"
              />
            </div>
            <aside className="pose-card">
              <div className="pose-heading">
                <h2>Pose preview</h2>
                <span className="small-dot" />
              </div>
              <PosePreview
                landmarks={live.landmarks}
                missing={!s || s.missingLandmarks}
              />
              <p>
                {source === "demo"
                  ? "Simulated shoulder · elbow · wrist"
                  : s?.missingLandmarks
                    ? "Show both arms to restore tracking"
                    : "Shoulder · elbow · wrist"}
              </p>
            </aside>
            <div className="gauge-area">
              <Gauge rate={rate} label={label} />
              <div className="coach-cue" role="status">
                <Icon name="pulse" />
                <span>{stage === "importing" ? loading : cue}</span>
              </div>
            </div>
            <div className="metrics">
              <div>
                <span>
                  Rhythm <span className="desktop-word">variation</span>
                </span>
                <strong>
                  {paused
                    ? "—"
                    : number(
                        s?.recentRhythmCv == null
                          ? null
                          : s.recentRhythmCv * 100,
                        0,
                        "%",
                      )}
                </strong>
                <small>Recent interval CV</small>
              </div>
              <div>
                <span>Hands-off</span>
                <strong>
                  {!s || s.missingLandmarks || paused
                    ? "—"
                    : number(s.pauseMs / 1000, 1, " s")}
                </strong>
                <small>
                  {s?.missingLandmarks
                    ? "Tracking unavailable"
                    : "Observed total"}
                </small>
              </div>
              <div>
                <span>
                  Elbow <span className="desktop-word">angle</span>
                </span>
                <strong>{number(elbow, 0, "°")}</strong>
                <small>2D estimate · both arms</small>
              </div>
            </div>
            {stage === "practice" ? (
              <div className="control-bar">
                <div className="practice-controls">
                  <button
                    className={`button ${audio.metronome ? "selected" : ""}`}
                    aria-pressed={audio.metronome}
                    onClick={audio.toggleMetronome}
                  >
                    <Icon name="beat" />
                    <span>
                      Beat {audio.metronome ? "on" : "off"}
                      <small>110 /min</small>
                    </span>
                  </button>
                  <button
                    className={`button ${audio.voiceAvailable && audio.voice ? "selected" : ""} ${!audio.voiceAvailable ? "voice-unavailable" : ""}`}
                    aria-pressed={audio.voiceAvailable && audio.voice}
                    disabled={!audio.voiceAvailable}
                    onClick={audio.toggleVoice}
                    title={
                      audio.voiceAvailable
                        ? "Short on-device voice cues"
                        : "No local English voice is available"
                    }
                  >
                    <Icon name="sound" />
                    {audio.voiceAvailable
                      ? `Voice ${audio.voice ? "on" : "off"}`
                      : "Voice (unavailable on this device)"}
                  </button>
                  <button className="button" onClick={togglePause}>
                    <Icon name={paused ? "play" : "pause"} />
                    {paused ? "Resume" : "Pause"}
                  </button>
                  <button
                    className="button primary"
                    onClick={() => runner.current?.finish()}
                  >
                    <Icon name="stop" /> End practice
                  </button>
                </div>
                <span className="results-promise">
                  <Icon name="clock" size={18} /> Your summary at 02:00
                </span>
              </div>
            ) : (
              <div className="import-controls">
                <p role="status">
                  {loading} {time(live.elapsed)} analyzed. Up to the first 2
                  minutes; shorter files end early.
                </p>
                <button className="button" onClick={home}>
                  <Icon name="close" /> Cancel analysis
                </button>
              </div>
            )}
            <div className="practice-footnote">
              <span>
                {audio.audioError ||
                  (!audio.voiceAvailable
                    ? "Voice needs a local English voice. Visual coaching stays on."
                    : "Optional sound plays on this device.")}
              </span>
              {stage === "practice" && (
                <button
                  className="text-button"
                  onClick={() => {
                    runner.current?.pause();
                    setPaused(true);
                    fileInput.current?.click();
                  }}
                >
                  <Icon name="upload" size={16} /> Import video
                </button>
              )}
            </div>
          </section>
        )}
        {stage === "results" && result && (
          <Results
            result={result}
            titleRef={title}
            onAgain={home}
            onDemo={() => start("demo")}
          />
        )}
        <div className="agent-wrap">
          <AgentAccess result={stage === "results" ? result : null} />
        </div>
      </main>
      <Footer />
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept="video/*,.mp4,.webm,.mov"
        tabIndex={-1}
        aria-label="Choose a local practice video"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
    </div>
  );
}
function Results({
  result,
  titleRef,
  onAgain,
  onDemo,
}: {
  result: ExportResult;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  onAgain: () => void;
  onDemo: () => void;
}) {
  const s = result.session;
  const goals = summarizeSession(s).nextPracticeGoals;
  const mainGoal =
    s.rate.averageCpm === null
      ? "Keep both arms visible and record enough movement to estimate your pace."
      : s.rate.inTargetFraction === 1
        ? "Keep a steady 100–120 /min rhythm in your next practice."
        : (goals.find((g) => /rhythm|pace|intervals/.test(g)) ?? goals[0]);
  return (
    <section className="results section-width">
      <div className="result-top">
        <div>
          <span className="eyebrow">03 / REFLECT & REPEAT</span>
          <h1 ref={titleRef} tabIndex={-1}>
            A little practice, in perspective.
          </h1>
          <p>
            {s.completed
              ? "Two minutes recorded. Here’s your rhythm summary."
              : "Practice ended early. Here’s what was observed."}
          </p>
        </div>
        <span className="badge accent">
          {result.is_demo ? "Simulated motion" : "Camera estimates"}
        </span>
      </div>
      <div className="result-meta">
        <span>
          <Icon name="check" size={16} />{" "}
          {s.completed ? "Completed" : "Ended early"}
        </span>
        <span>{time(s.durationMs)} recorded</span>
        <span>{number(result.paused_ms / 1000, 1)} s user-paused</span>
        <span>
          {new Date(result.started_at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          –{" "}
          {new Date(result.ended_at).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="result-layout">
        <div className="target-result">
          <span className="eyebrow">IN THE TARGET BAND</span>
          <strong>{percent(s.rate.inTargetFraction)}</strong>
          <h2>of evaluable intervals</h2>
          <div className="target-track">
            <span
              style={{ width: `${(s.rate.inTargetFraction ?? 0) * 100}%` }}
            />
          </div>
          <p>
            {s.rate.inTargetCount} of {s.rate.evaluableCount} intervals at
            100–120 /min.
            <br />
            {percent(s.rate.inTargetFraction === null ? null : 1 - s.rate.inTargetFraction)} outside the target band.
            <br />
            {s.compressionCount} wrist cycles detected.
          </p>
          <span className="badge">
            {result.is_demo
              ? "Demo data · illustrative only"
              : "Estimated · not a competence score"}
          </span>
        </div>
        <div className="result-metrics">
          <ResultMetric
            label="Average rate"
            value={number(s.rate.averageCpm, 1)}
            unit="/min"
            detail="All valid intervals"
          />
          <ResultMetric
            label="Rhythm variation"
            value={number(
              s.rate.rhythmCv === null ? null : s.rate.rhythmCv * 100,
              1,
              "%",
            )}
            detail="Whole-session interval CV"
          />
          <ResultMetric
            label="Observed stops"
            value={s.activity.observedMs ? String(s.pauses.count) : "—"}
            detail={
              s.activity.observedMs
                ? `${number(s.pauses.totalMs / 1000, 1)} s total · gaps ≥ 2 seconds`
                : "No observed time"
            }
          />
          <ResultMetric
            label="Arms extended"
            value={percent(s.arms.bothStraightFraction)}
            detail={`${percent(s.arms.bothStraightFraction === null ? null : 1 - s.arms.bothStraightFraction)} arms bent · of arm-observed time · 2D`}
          />
          <ResultMetric
            label="Elbow angles"
            value={`${number(s.arms.meanLeftDeg, 0, "°")} / ${number(s.arms.meanRightDeg, 0, "°")}`}
            detail="Left / right · time-weighted means"
          />
          <ResultMetric
            label="Tracking coverage"
            value={percent(result.measurement.valid_tracking_fraction)}
            detail={`${number(s.activity.unknownMs / 1000, 1)} s unknown · not counted as stops`}
          />
        </div>
      </div>
      <div className="next-goal">
        <span className="goal-icon">
          <Icon name="arrow" size={24} />
        </span>
        <div>
          <span className="eyebrow">YOUR NEXT PRACTICE</span>
          <h2>{mainGoal}</h2>
          <p>
            {s.activity.unknownMs > 500
              ? "Adjust the view so both shoulders, elbows and wrists stay visible."
              : "Use a cushion or manikin and focus on an even rhythm."}
          </p>
        </div>
      </div>
      <div className="result-actions">
        <button className="button primary" onClick={onAgain}>
          <Icon name="arrow" /> Practice again
        </button>
        <button className="button" onClick={() => downloadResult(result)}>
          <Icon name="download" /> Export JSON
        </button>
        {result.is_demo && (
          <button className="text-button" onClick={onDemo}>
            Replay demo
          </button>
        )}
        <span>Estimates for reflection. No depth or lifesaving score.</span>
      </div>
      <details className="measurement-details">
        <summary>How to read these estimates</summary>
        <p>
          Rate uses valid intervals between detected wrist cycles; first cycles
          and intervals across tracking loss or stops are excluded. Rhythm is
          the population standard deviation divided by mean interval. Stops are
          fully observed gaps of at least 2 seconds, measured peak to peak.
          Unknown time is never treated as a stop.
        </p>
        <p>
          Arms extended means both projected elbows meet the prototype’s 160°
          threshold; this is not a medical cutoff. Camera angle and occlusion
          affect it. Live rate uses the latest five events, while this summary
          uses the entire recorded practice. A dash means unavailable. Export
          JSON includes the exact configuration and missing-data totals.
        </p>
      </details>
    </section>
  );
}
function ResultMetric({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: string;
  unit?: string;
  detail: string;
}) {
  return (
    <div className="result-metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>{detail}</p>
    </div>
  );
}

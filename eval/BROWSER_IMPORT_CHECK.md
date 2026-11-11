# Browser import check (2026-11-09)

A one-off check of **Import a practice video** in a real browser, separate from the synthetic evaluation in `RESULTS.md`. It shows that the published build completes an import end to end. It does not measure accuracy.

## Setup

- App: the published GitHub Pages build (https://driedsandwich.github.io/cpr-pace-coach/), deployed from commit `4697512`, opened in Google Chrome (headless, temporary profile, 1920×1080, driven by Playwright). A clip was chosen in the page's file input and the run was left to finish; the result was saved with **Export JSON**.
- Model and settings as exported: MediaPipe Pose Landmarker lite (float16), Tasks Vision SDK 1.2.2, 30 Hz seek grid, default detector settings.
- Footage: "Save a Life Cymru - Training video" by the Welsh Government, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/), from Wikimedia Commons (https://commons.wikimedia.org/wiki/File:Save_a_Life_Cymru_-_Training_video.webm). Two clips (VP8, 1280×720) were cut from it with ffmpeg. Neither the film nor the clips are included in this repository.
  - Clip B, 4:55–5:25: one of the film's chest-compression scenes.
  - Clip C, 0:40–0:52: a control in which a person's upper body faces the camera and no compressions are performed.
- Pass line for clip B, written down before the run: finishes without error, valid tracking at least 50%, mean rate 80–140 /min, and at least 20 compressions counted.

## Results (from the exported JSON)

| Clip | Length | Finished without error | Valid tracking | Compressions counted | Mean rate |
|---|---:|---|---:|---:|---|
| B, compressions | 30.03 s | yes | 20.6% | 5 | not reported (no evaluable interval) |
| C, control, no compressions | 12.01 s | yes | 41.3% | 3 | not reported (no evaluable interval) |

## Reading

- The import path runs in a real browser and produces a valid export for both clips.
- Clip B misses three of the four pass lines. The film is shot from the rescuer's eye level, so the compressing arms appear only from the forearms down and the rescuer's shoulders and elbows, which the detector needs, are out of frame. The poses that were found appear to belong to other people in the scene.
- Clip C counted 3 cycles although no compressions were performed: unrelated movement can be counted. This is one of the limits listed in `RESULTS.md`.
- This check does not establish accuracy on real footage. The setup screen asks for a camera to the side with both shoulders, elbows and wrists in frame.

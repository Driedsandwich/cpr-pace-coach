#!/usr/bin/env bash
# Usage: scripts/assemble-demo.sh VIDEO_DIR AUDIO_DIR_OR_- SCENES_JSON [OUTPUT_MP4]
# Requires: python3, ffmpeg (libx264, libass), ffprobe, an installed sans-serif font.
# Optional env: FFMPEG, FFPROBE, DEMO_FONT_DIR (directory containing TTF/OTF fonts).
# Narration extends a scene with tpad; shorter narration never cuts off an action.
# No WAVs => silent output at storyboard durations. Mixed WAVs => silence in gaps.
set -euo pipefail
if (( $# < 3 || $# > 4 )); then
  echo 'Usage: assemble-demo.sh VIDEO_DIR AUDIO_DIR_OR_- SCENES_JSON [OUTPUT_MP4]' >&2
  exit 2
fi
python3 - "$@" <<'PY'
import json, math, os, pathlib, shutil, subprocess, sys, tempfile, textwrap
video_dir = pathlib.Path(sys.argv[1]).resolve()
audio_dir = None if sys.argv[2] == '-' else pathlib.Path(sys.argv[2]).resolve()
manifest = json.loads(pathlib.Path(sys.argv[3]).read_text())
output = pathlib.Path(sys.argv[4]).resolve() if len(sys.argv)>4 else video_dir/'demo_silent_captioned.mp4'
ffmpeg, ffprobe = os.getenv('FFMPEG','ffmpeg'), os.getenv('FFPROBE','ffprobe')
def run(args, **kw):
    return subprocess.run(args, check=True, **kw)
def duration(file):
    value = float(subprocess.check_output([ffprobe,'-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(file)]))
    if not math.isfinite(value) or value <= 0: raise ValueError('Invalid media duration')
    return value
def timestamp(s):
    cs = round(s*100)
    return f'{cs//360000}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'
def ass_text(text):
    # Treat manifest text as text, never as ASS control codes.
    text = str(text).replace('\\','＼').replace('{','｛').replace('}','｝')
    return r'\N'.join(textwrap.wrap(text, width=100))
scenes = manifest['scenes']
ids = [s['number'] for s in scenes]
if not ids or len(ids)!=len(set(ids)) or any(type(i)!=int or i<1 for i in ids):
    raise ValueError('Scene numbers must be unique positive integers')
rows=[]
for s in scenes:
    stem=f"scene_{s['number']:02}"
    v=video_dir/(stem+'.mp4')
    if not v.is_file(): raise FileNotFoundError(v)
    a=audio_dir/(stem+'.wav') if audio_dir else None
    a=a if a and a.is_file() else None
    planned=float(s['duration_seconds'])
    if not math.isfinite(planned) or planned<=0: raise ValueError('Invalid storyboard duration')
    vd=duration(v)
    # Keep all source actions if narration exists; otherwise honor the storyboard.
    target=math.ceil(max(planned, vd, duration(a) if a else 0)*30-1e-5)/30 if a else planned
    rows.append((s,v,a,target))
with_audio=any(a for _,_,a,_ in rows)
if output in [p for _,v,a,_ in rows for p in (v,a) if p]:
    raise ValueError('Output must not overwrite an input')
output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='demo-assemble-') as work:
    tmp=pathlib.Path(work)
    fonts=os.getenv('DEMO_FONT_DIR')
    if fonts: shutil.copytree(fonts,tmp/'fonts')
    parts=[]
    for index,(s,v,a,target) in enumerate(rows):
        caps=s.get('recording_captions') or s.get('captions') or [{'start_seconds':0,'end_seconds':target,'text':s['subtitle']}]
        ass='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,DejaVu Sans,30,&H00FFFFFF,&H00FFFFFF,&H001B2027,&H001B2027,0,0,0,0,100,100,0,0,1,1,0,2,90,90,22,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
        previous=0
        for j,c in enumerate(caps):
            start=float(c['start_seconds']); end=float(c['end_seconds'])
            if not (math.isfinite(start) and math.isfinite(end) and 0<=start<end and start>=previous):
                raise ValueError('Captions must be ordered and non-overlapping')
            previous=end
            if j==len(caps)-1: end=max(end,target)
            if start<target:
                ass+=f'Dialogue: 0,{timestamp(start)},{timestamp(min(end,target))},Caption,,0,0,0,,{ass_text(c["text"])}\n'
        (tmp/'captions.ass').write_text(ass)
        vf=f'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,tpad=stop_mode=clone:stop_duration={target},trim=duration={target},setpts=PTS-STARTPTS,drawbox=x=0:y=976:w=iw:h=104:color=0x1b2027:t=fill,subtitles=filename=captions.ass'
        if fonts: vf+=':fontsdir=fonts'
        cmd=[ffmpeg,'-hide_banner','-loglevel','error','-y','-i',str(v)]
        if with_audio:
            cmd+=['-i',str(a)] if a else ['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']
        cmd+=['-map','0:v:0','-vf',vf,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-threads','4','-r','30','-fps_mode','cfr']
        if with_audio:
            cmd+=['-map','1:a:0','-af',f'aresample=48000,apad,atrim=duration={target},asetpts=PTS-STARTPTS','-c:a','aac','-b:a','192k','-ar','48000','-ac','2']
        else: cmd+=['-an']
        part=f'part_{index:02}.mp4'; parts.append(part)
        cmd+=['-t',str(target),'-movflags','+faststart',part]
        print(f"Assembling scene {s['number']:02}: {target:.3f} s",flush=True)
        run(cmd,cwd=tmp)
    (tmp/'concat.txt').write_text(''.join(f"file '{p}'\n" for p in parts))
    run([ffmpeg,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','1','-i','concat.txt','-c','copy','-movflags','+faststart',str(output)],cwd=tmp)
print(f'Created {output.name}: {sum(r[3] for r in rows):.3f} s; '+('AAC audio' if with_audio else 'no audio stream'))
PY

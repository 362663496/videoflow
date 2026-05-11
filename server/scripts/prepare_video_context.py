#!/usr/bin/env python3
"""Prepare local context for video-script-prompter.

Creates a per-video work directory containing:
- video_context.json: ffprobe metadata + extracted artifact paths
- context.md: human-readable summary for the agent
- frames/*.jpg: timestamped representative frames
- audio.wav: mono 16 kHz audio when an audio stream exists and extraction succeeds
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    sys.exit(1)


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        fail(f"{name} is required but was not found in PATH")
    return path


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check)


def safe_name(value: str) -> str:
    value = re.sub(r"[\\/:*?\"<>|\s]+", "-", value.strip())
    value = re.sub(r"-+", "-", value).strip("-._")
    return value or "video"


def parse_rate(rate: str | None) -> float | None:
    if not rate or rate == "0/0":
        return None
    if "/" in rate:
        a, b = rate.split("/", 1)
        try:
            denom = float(b)
            return float(a) / denom if denom else None
        except ValueError:
            return None
    try:
        return float(rate)
    except ValueError:
        return None


def probe(video: Path) -> dict[str, Any]:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration,bit_rate,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration",
        "-of",
        "json",
        str(video),
    ]
    result = run(cmd)
    data = json.loads(result.stdout or "{}")
    streams = data.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), {})
    duration = None
    for candidate in (data.get("format", {}).get("duration"), video_stream.get("duration")):
        try:
            duration = float(candidate)
            break
        except (TypeError, ValueError):
            pass
    fps = parse_rate(video_stream.get("avg_frame_rate")) or parse_rate(video_stream.get("r_frame_rate"))
    return {
        "source": str(video),
        "format": data.get("format", {}),
        "duration_seconds": duration,
        "video": {
            "codec": video_stream.get("codec_name"),
            "width": video_stream.get("width"),
            "height": video_stream.get("height"),
            "fps": fps,
        },
        "audio": {"present": bool(audio_stream), "codec": audio_stream.get("codec_name")},
        "streams": streams,
    }


def timestamp_label(seconds: float) -> str:
    return f"{seconds:07.2f}s"


def frame_name(index: int, seconds: float) -> str:
    return f"frame_{index:03d}_{timestamp_label(seconds)}.jpg"


def sample_timestamps(duration: float | None, interval: float, max_frames: int) -> list[float]:
    if not duration or duration <= 0:
        return [0.0]
    count = min(max_frames, max(1, int(math.floor(duration / interval)) + 1))
    values = [min(duration, i * interval) for i in range(count)]
    if duration > 0 and (duration - values[-1]) > 0.75 and len(values) < max_frames:
        values.append(max(0.0, duration - 0.15))
    return values


def extract_frames(video: Path, frames_dir: Path, timestamps: list[float]) -> list[dict[str, Any]]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    frames: list[dict[str, Any]] = []
    for index, seconds in enumerate(timestamps, start=1):
        out = frames_dir / frame_name(index, seconds)
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            f"{seconds:.3f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(out),
        ]
        result = run(cmd, check=False)
        if result.returncode == 0 and out.exists():
            frames.append({"index": index, "timestamp_seconds": round(seconds, 3), "path": str(out)})
        else:
            print(f"WARN: frame extraction failed at {seconds:.2f}s: {result.stderr.strip()}", file=sys.stderr)
    return frames


def extract_audio(video: Path, output_dir: Path, enabled: bool, has_audio: bool) -> str | None:
    if not enabled or not has_audio:
        return None
    out = output_dir / "audio.wav"
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(out),
    ]
    result = run(cmd, check=False)
    if result.returncode == 0 and out.exists():
        return str(out)
    print(f"WARN: audio extraction failed: {result.stderr.strip()}", file=sys.stderr)
    return None


def write_context_md(output_dir: Path, metadata: dict[str, Any], frames: list[dict[str, Any]], audio_path: str | None) -> Path:
    duration = metadata.get("duration_seconds")
    video_meta = metadata.get("video", {})
    lines = [
        "# Video Context",
        "",
        f"- Source: `{metadata.get('source')}`",
        f"- Duration: `{duration:.2f}s`" if isinstance(duration, (int, float)) else "- Duration: unknown",
        f"- Resolution: `{video_meta.get('width')}x{video_meta.get('height')}`",
        f"- FPS: `{video_meta.get('fps')}`",
        f"- Audio: `{'yes' if metadata.get('audio', {}).get('present') else 'no'}`",
        f"- Extracted audio: `{audio_path}`" if audio_path else "- Extracted audio: none",
        "",
        "## Representative Frames",
        "",
    ]
    for frame in frames:
        lines.append(f"- {frame['timestamp_seconds']:.2f}s — `{frame['path']}`")
    path = output_dir / "context.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare context artifacts for video-script-prompter")
    parser.add_argument("video", help="Path to the source video file")
    parser.add_argument("--output-dir", default="~/output", help="Root output directory")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between representative frames")
    parser.add_argument("--max-frames", type=int, default=24, help="Maximum number of representative frames")
    parser.add_argument("--no-audio", action="store_true", help="Do not extract audio.wav")
    args = parser.parse_args()

    require_tool("ffprobe")
    require_tool("ffmpeg")

    video = Path(args.video).expanduser().resolve()
    if not video.exists():
        fail(f"video file does not exist: {video}")
    if not video.is_file():
        fail(f"video path is not a file: {video}")
    if args.interval <= 0:
        fail("--interval must be > 0")
    if args.max_frames <= 0:
        fail("--max-frames must be > 0")

    root = Path(args.output_dir).expanduser().resolve()
    output_dir = root / safe_name(video.stem)
    frames_dir = output_dir / "frames"
    output_dir.mkdir(parents=True, exist_ok=True)

    metadata = probe(video)
    timestamps = sample_timestamps(metadata.get("duration_seconds"), args.interval, args.max_frames)
    frames = extract_frames(video, frames_dir, timestamps)
    audio_path = extract_audio(video, output_dir, not args.no_audio, metadata.get("audio", {}).get("present", False))

    metadata["artifacts"] = {
        "output_dir": str(output_dir),
        "frames": frames,
        "audio": audio_path,
        "suggested_files": {
            "complete_script": str(output_dir / "完整剧本.md"),
            "storyboard_script": str(output_dir / "分镜剧本.md"),
        },
    }

    manifest = output_dir / "video_context.json"
    manifest.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    context_md = write_context_md(output_dir, metadata, frames, audio_path)

    print(json.dumps({"output_dir": str(output_dir), "manifest": str(manifest), "context_md": str(context_md), "frames": len(frames), "audio": audio_path}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

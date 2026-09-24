"""Re-transcribe a vocal stem with faster-whisper and word timestamps.

    python3 transcribe.py <vocals.wav> <out.json> [model] [prompt] [vad]

Writes [{word, start, end, probability}] like performance.json's words.
"""
import json, sys, time
from faster_whisper import WhisperModel

source, out = sys.argv[1], sys.argv[2]
model_name = sys.argv[3] if len(sys.argv) > 3 else "large-v3-turbo"
prompt = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
vad = len(sys.argv) > 5 and sys.argv[5] == "vad"
began = time.time()
model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=4)
segments, info = model.transcribe(source, language="en", word_timestamps=True, beam_size=5,
                                  condition_on_previous_text=False, vad_filter=vad, hallucination_silence_threshold=2.0,
                                  vad_parameters={"min_silence_duration_ms": 700, "speech_pad_ms": 300},
                                  initial_prompt=prompt, no_speech_threshold=0.5)
words = []
for segment in segments:
    for word in segment.words or []:
        words.append({"word": word.word.strip(), "start": round(word.start, 3), "end": round(word.end, 3),
                      "probability": round(word.probability, 3)})
    print(f"[{segment.start:7.2f}] {segment.text}", file=sys.stderr, flush=True)
json.dump(words, open(out, "w"), indent=0)
print(f"{len(words)} words in {time.time() - began:.0f}s", file=sys.stderr)

"""
Нейтральная фоновая музыка для приветственного видео — синтезируется здесь же, без чужих треков и лицензий:
тёплый пэд на четырёх аккордах (Cmaj7 – Am7 – Fmaj7 – G6) и тихое арпеджио сверху, мягкое эхо.
  python music.py <секунд> <out.wav>
"""
import sys

import numpy as np
import soundfile as sf

RATE = 48000
BPM = 84
BAR = 4 * 60 / BPM
CHORDS = [  # MIDI-ноты
    [48, 55, 59, 64, 67],  # Cmaj7
    [45, 52, 55, 60, 64],  # Am7
    [41, 48, 52, 57, 64],  # Fmaj7
    [43, 50, 55, 59, 64],  # G6
]


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def envelope(n, attack, release):
    env = np.ones(n)
    a, r = int(attack * RATE), int(release * RATE)
    env[:a] = np.linspace(0, 1, a)
    env[-r:] *= np.linspace(1, 0, r)
    return env


def pad(note, seconds):
    t = np.arange(int(seconds * RATE)) / RATE
    f = hz(note)
    # Несколько слегка расстроенных синусов с обертонами — мягко и «тепло».
    tone = sum(np.sin(2 * np.pi * f * d * t) for d in (0.997, 1.0, 1.003)) / 3
    tone += 0.25 * np.sin(2 * np.pi * f * 2 * t) + 0.08 * np.sin(2 * np.pi * f * 3 * t)
    return tone * envelope(len(t), 1.2, 1.6)


def pluck(note, seconds=1.4):
    t = np.arange(int(seconds * RATE)) / RATE
    f = hz(note)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2 * t)) * np.exp(-t * 3.2) * envelope(len(t), 0.005, 0.3)


def echo(x, delay=0.36, feedback=0.35, times=4):
    out = x.copy()
    d = int(delay * RATE)
    for i in range(1, times + 1):
        out[i * d:] += x[: len(x) - i * d] * feedback ** i
    return out


def lowpass(x, cutoff=2400):
    # Простой однополюсный фильтр — срезать «стеклянный» верх.
    a = np.exp(-2 * np.pi * cutoff / RATE)
    y = np.zeros_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def add(mix, at, sound):
    end = min(len(mix), at + len(sound))
    if at < end:
        mix[at:end] += sound[: end - at]


def main(seconds, out):
    total = int((seconds + 2) * RATE)
    mix = np.zeros(total)
    bar, start = 0, 0.0
    while start < seconds + 1:
        chord = CHORDS[bar % len(CHORDS)]
        s = int(start * RATE)
        for note in chord:
            add(mix, s, pad(note, BAR + 1.6) * 0.09)
        # Арпеджио восьмыми, на октаву выше, через такт пореже.
        step = BAR / 8
        for i in range(8 if bar % 2 == 0 else 4):
            note = chord[[1, 2, 3, 4, 3, 2, 3, 4][i]] + 12
            k = int((start + i * step * (1 if bar % 2 == 0 else 2)) * RATE)
            add(mix, k, pluck(note) * 0.05)
        bar += 1
        start += BAR
    mix = echo(lowpass(mix))[: int(seconds * RATE)]
    mix *= envelope(len(mix), 1.5, 3.0)
    mix /= np.max(np.abs(mix)) / 0.8
    sf.write(out, np.stack([mix, np.roll(mix, int(0.012 * RATE))], axis=1), RATE)


if __name__ == "__main__":
    main(float(sys.argv[1]), sys.argv[2])

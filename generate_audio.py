#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_audio.py — генерация озвучки диалогов 듣기 через ElevenLabs.

ЧТО ДЕЛАЕТ:
  Читает data.json (лежит рядом), берёт все диалоги из "listening",
  и для каждой реплики создаёт mp3 в папке ./audio/ с именем
  {id}_{индекс}_{F|M}.mp3  — ровно те имена, что ждёт приложение.
  Мужские реплики (spk="M") озвучиваются мужским голосом,
  женские (spk="F") — женским.

КАК ЗАПУСТИТЬ (у себя на компьютере):
  1) pip install requests
  2) Впиши свой ключ в API_KEY ниже (или задай переменную окружения ELEVENLABS_API_KEY)
  3) (по желанию) поставь свои voice_id в VOICE_F / VOICE_M
  4) python3 generate_audio.py
  5) Папку audio/ положи в корень репозитория рядом с index.html и запушь на GitHub Pages.

ЗАМЕЧАНИЯ:
  - Скрипт пропускает файлы, которые уже созданы (можно прерывать и продолжать).
  - Модель eleven_multilingual_v2 хорошо читает корейский.
"""

import os, json, sys, time

try:
    import requests
except ImportError:
    print("Нужен модуль requests:  pip install requests")
    sys.exit(1)

# ---------------- НАСТРОЙКИ ----------------
API_KEY = os.environ.get("ELEVENLABS_API_KEY", "PASTE_YOUR_ELEVENLABS_API_KEY_HERE")

# Голоса ElevenLabs. Значения ниже — популярные мультиязычные пресеты.
# Замени на любые из своей библиотеки (Voices -> ID).
VOICE_F = os.environ.get("EL_VOICE_F", "21m00Tcm4TlvDq8ikWAM")  # женский (Rachel)
VOICE_M = os.environ.get("EL_VOICE_M", "onwK4e9ZLuTAKqWW03F9")  # мужской (Daniel)

MODEL_ID = "eleven_multilingual_v2"
OUT_DIR  = "audio"
DATA     = "data.json"
# -------------------------------------------

def tts(text, voice_id, out_path):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": MODEL_ID,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0},
    }
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
    with open(out_path, "wb") as f:
        f.write(r.content)

def main():
    if API_KEY.startswith("PASTE_"):
        print("!! Впиши свой ELEVENLABS_API_KEY в скрипт или в переменную окружения.")
        sys.exit(1)
    if not os.path.exists(DATA):
        print(f"!! Не найден {DATA}. Положи его рядом со скриптом.")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    data = json.load(open(DATA, encoding="utf-8"))
    dialogues = data["listening"]

    total = sum(len(d["lines"]) for d in dialogues)
    done = 0
    print(f"Всего реплик для озвучки: {total}\n")

    for d in dialogues:
        did = d["id"]
        for i, ln in enumerate(d["lines"]):
            spk = ln["spk"]                      # 'F' или 'M'
            voice = VOICE_F if spk == "F" else VOICE_M
            fname = f"{did}_{i}_{spk}.mp3"
            out = os.path.join(OUT_DIR, fname)
            done += 1
            if os.path.exists(out) and os.path.getsize(out) > 0:
                print(f"[{done}/{total}] пропуск (уже есть): {fname}")
                continue
            text = ln["ko"]
            try:
                tts(text, voice, out)
                print(f"[{done}/{total}] OK  {fname}  «{text[:24]}…»")
                time.sleep(0.4)   # мягкая пауза, чтобы не упереться в лимиты
            except Exception as e:
                print(f"[{done}/{total}] ОШИБКА {fname}: {e}")
                time.sleep(2)

    print("\nГотово. Папка audio/ заполнена. Клади её в репозиторий рядом с index.html.")

if __name__ == "__main__":
    main()

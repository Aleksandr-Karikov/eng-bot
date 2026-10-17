# Разведка: локальная генерация картинок-ассоциаций

Не часть бота — замеры, потянет ли мак. Окружение и картинки в git не попадают.

```bash
# 1. uv — менеджер Python-окружений (если нет)
brew install uv            # или: curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Изолированное окружение на Python 3.12
cd ~/projects/eng-bot/tools/imagegen
uv venv --python 3.12 .venv
source .venv/bin/activate

# 3. SDXL-Turbo (~7 ГБ модели скачается при первом запуске)
uv pip install torch diffusers transformers accelerate
python sdxl_turbo.py

# 4. FLUX.1-schnell 4-bit через MLX (~10 ГБ модели)
uv pip install mflux
/usr/bin/time -l mflux-generate --model dhairyashil/FLUX.1-schnell-mflux-4bit --base-model schnell \
  --steps 2 --seed 42 --width 512 --height 512 \
  --prompt "$(cat prompt.txt)" --output out/flux-schnell.png
```

Картинки — в `out/`. Удалить всё скачанное: `rm -rf .venv out ~/.cache/huggingface/hub/models--stabilityai--sdxl-turbo ~/.cache/huggingface/hub/models--madebyollin--sdxl-vae-fp16-fix ~/.cache/huggingface/hub/models--dhairyashil--FLUX.1-schnell-mflux-4bit`

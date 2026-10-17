"""Замер SDXL-Turbo на Apple Silicon: время загрузки, время на картинку (1 и 4 шага), память."""
import sys
import time
from pathlib import Path

import torch
from diffusers import AutoencoderKL, AutoPipelineForText2Image

here = Path(__file__).parent
prompt = sys.argv[1] if len(sys.argv) > 1 else (here / "prompt.txt").read_text().strip()

started = time.time()
# Стандартный VAE SDXL в fp16 на MPS даёт чёрные картинки — берём исправленный.
vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
pipe = AutoPipelineForText2Image.from_pretrained(
    "stabilityai/sdxl-turbo", vae=vae, torch_dtype=torch.float16, variant="fp16"
).to("mps")
print(f"load: {time.time() - started:.1f} s")

for steps in (1, 4):
    started = time.time()
    image = pipe(prompt=prompt, num_inference_steps=steps, guidance_scale=0.0, width=512, height=512).images[0]
    out = here / "out" / f"sdxl-turbo-{steps}step.png"
    image.save(out)
    print(f"{steps} step(s): {time.time() - started:.1f} s -> {out}")

print(f"GPU memory: {torch.mps.driver_allocated_memory() / 2**30:.1f} GB")

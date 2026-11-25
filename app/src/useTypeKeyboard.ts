import { viewport as telegramViewport } from "@telegram-apps/sdk-react";
import { useEffect, useRef, useState } from "react";

/** Оставляет поле и кнопки видимыми, когда клавиатура уменьшает высоту WebView. */
export function useTypeKeyboard(enabled = true) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const deck = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) {
      setKeyboardOpen(false);
      return;
    }
    const panel = deck.current;
    const field = input.current;
    if (!panel || !field) return;
    const viewport = window.visualViewport;
    const visibleHeight = () => Math.min(
      viewport?.height ?? window.innerHeight,
      telegramViewport.stableHeight() || Infinity,
    );
    let restingHeight = visibleHeight();
    let editing = false;
    const fit = () => {
      const height = visibleHeight();
      const focused = document.activeElement === field;
      if ((!focused && !editing) || height > restingHeight) restingHeight = height;
      const open = (focused || editing) && restingHeight - height > 100;
      // Тап по кнопке может снять фокус до закрытия клавиатуры.
      editing = focused || open;
      setKeyboardOpen(open);
      if (open) {
        panel.style.setProperty("--type-viewport-height", `${height}px`);
        panel.style.setProperty("--type-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      }
    };
    field.addEventListener("focus", fit);
    field.addEventListener("blur", fit);
    window.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    const stopTelegram = telegramViewport.stableHeight.sub(fit);
    return () => {
      stopTelegram();
      field.removeEventListener("focus", fit);
      field.removeEventListener("blur", fit);
      window.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
    };
  }, [enabled]);

  return { input, deck, keyboardOpen: enabled && keyboardOpen };
}

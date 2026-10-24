import { Button } from "@telegram-apps/telegram-ui";
import { studyLanguage } from "./language";

/** 🔊 UK / 🔊 US — или одна «🔊 Озвучка», если у изучаемого языка одно произношение. */
export function AudioButtons({ size, onPlay }: { size: "s" | "m"; onPlay: (accent: "uk" | "us") => void }) {
  const { accents } = studyLanguage();
  if (accents.length === 1) {
    return (
      <Button mode="bezeled" size={size} onClick={() => onPlay(accents[0].key)}>
        🔊 Озвучка
      </Button>
    );
  }
  return (
    <>
      {accents.map((a) => (
        <Button key={a.key} mode="bezeled" size={size} onClick={() => onPlay(a.key)}>
          🔊 {a.key.toUpperCase()}
        </Button>
      ))}
    </>
  );
}

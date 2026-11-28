import { Text } from "@telegram-apps/telegram-ui";
import type { CheckResult } from "../../src/llm/enricher";

export function LanguageFixes({ fixes, lang }: { fixes: CheckResult["fixes"]; lang: "en" | "ru" }) {
  if (fixes.length === 0) return null;
  return (
    <>
      <Text weight="2">Что исправить</Text>
      <ul className="language-fixes">
        {fixes.map(({ wrong, right, why }, index) => (
          <li key={index}>
            <Text lang={lang}><del>{wrong}</del> → <b>{right}</b></Text>
            {why && <Text className="hint">{why}</Text>}
          </li>
        ))}
      </ul>
    </>
  );
}

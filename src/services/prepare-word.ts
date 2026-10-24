import type { Deps } from "../bot/context";
import { isRussian, type Enrichment } from "../llm/enricher";
import { rateUsefulness } from "./usefulness";
import { findWord, type WordDraft } from "./words";

export type PreparedWord =
  /** Уже есть в комнате (для русского ввода — его английский вариант). */
  | { status: "exists"; term: string }
  /** Русское слово, а английский вариант модель не подобрала. */
  | { status: "no-english"; term: string }
  /** Черновик; translation может быть пустым — перевод не подобрался, его надо спросить у человека. */
  | { status: "ok"; draft: WordDraft };

/**
 * Черновик слова для /add и для приложения: перевод, транскрипция, пример, полезность и запоминалка.
 * «зуб» — модель подберёт английский вариант; «зуб — tooth» (наоборот) — переворачиваем.
 */
export async function prepareWord(
  deps: Pick<Deps, "db" | "enricher" | "tutor" | "frequency">,
  roomId: number,
  input: { term: string; translation?: string },
): Promise<PreparedWord> {
  let { term, translation } = input;
  if (translation && isRussian(term) && !isRussian(translation)) [term, translation] = [translation, term];
  const fromRussian = isRussian(term);
  if (!fromRussian && (await findWord(deps.db, roomId, term))) return { status: "exists", term };

  const enrich = deps.enricher
    .enrich(term, translation)
    .then(async (e) => (await rateUsefulness([{ ...e, term: e.term ?? term }], deps.frequency))[0])
    .catch((err): Enrichment | undefined => {
      console.error("Enrichment failed", term, err);
      return undefined;
    });
  const mnemonicFor = (t: string, tr: string) =>
    deps.tutor
      .mnemonics([{ term: t, translation: tr }])
      .then(([m]) => m ?? "")
      .catch((err) => {
        console.error("Mnemonic failed", t, err);
        return "";
      });

  let enrichment: Enrichment | undefined;
  let mnemonic: string;
  if (fromRussian) {
    // Запоминалку — уже для английского слова, поэтому после перевода.
    enrichment = await enrich;
    if (!enrichment?.term) return { status: "no-english", term };
    term = enrichment.term;
    if (await findWord(deps.db, roomId, term)) return { status: "exists", term };
    mnemonic = await mnemonicFor(term, enrichment.translation);
  } else {
    // Перевод и запоминалка (другой, более сильной моделью) — параллельно.
    [enrichment, mnemonic] = await Promise.all([enrich, mnemonicFor(term, translation ?? "")]);
  }
  return {
    status: "ok",
    draft: {
      term,
      // Для русского слова перевод — от модели (она могла уточнить его), а не само русское слово.
      translation: (fromRussian ? enrichment?.translation : translation) ?? enrichment?.translation ?? "",
      explanation: enrichment?.explanation ?? "",
      example: enrichment?.example ?? "",
      transcriptionUk: enrichment?.transcriptionUk ?? "",
      transcriptionUs: enrichment?.transcriptionUs ?? "",
      usefulness: enrichment?.usefulness,
      usefulnessNote: enrichment?.usefulnessNote ?? "",
      mnemonic,
    },
  };
}

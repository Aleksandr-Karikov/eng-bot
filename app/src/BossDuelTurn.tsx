import { Button, Text } from "@telegram-apps/telegram-ui";
import { useState } from "react";
import type { BossAttack, BossMove } from "./api";
import { hpFormat } from "./format";

export function BossDuelTurn({ attack, bossHp, busy, onMove }: {
  attack: Extract<BossAttack, { kind: "dragon" }>;
  bossHp: number;
  busy: boolean;
  onMove: (move: BossMove) => void;
}) {
  const [action, setAction] = useState(attack.choices.length === 1 ? attack.choices[0].id : "");
  const [order, setOrder] = useState<number[]>([]);
  const choice = attack.choices.find(({ id }) => id === action);
  const damage = (value: number) => hpFormat.format(attack.practice ? value : Math.min(value, bossHp));

  return (
    <>
      <div className="arena-turn-head">
        <Text weight="2" className="arena-term">{attack.cue}</Text>
        <span className="arena-note">{attack.duel.title} · ход {attack.turn}</span>
      </div>
      {attack.translation && <span className="arena-note">Правильная фраза — «{attack.translation}».</span>}
      {!choice ? (
        <div className="arena-options">
          {attack.choices.map((option) => (
            <Button key={option.id} className="arena-option" stretched disabled={busy} onClick={() => setAction(option.id)}>
              <span className="duel-choice">
                <strong>{option.label}</strong>
                <small>{option.words.length} {option.words.length < 5 ? "слова" : "слов"} · до {damage(option.damage ?? 0)} HP</small>
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <>
          <Text weight="2">Собери фразу «{choice.prompt}»</Text>
          <div className="duel-phrase" aria-label="Собранная фраза" aria-live="polite">
            {order.length ? order.map((index) => <span key={index} lang="en">{choice.words[index]}</span>)
              : <span className="arena-note">Нажимай на слова по порядку</span>}
          </div>
          <div className="duel-tiles" role="group" aria-label="Слова фразы">
            {choice.words.map((word, index) => (
              <Button key={index} type="button" className="arena-option" disabled={busy || order.includes(index)}
                onClick={() => setOrder((current) => current.includes(index) ? current : [...current, index])}>
                <span lang="en">{word}</span>
              </Button>
            ))}
          </div>
          <div className="duel-phrase-tools">
            {attack.choices.length > 1 && <button type="button" disabled={busy} onClick={() => { setOrder([]); setAction(""); }}>Сменить действие</button>}
            <button type="button" disabled={busy || !order.length} onClick={() => setOrder((current) => current.slice(0, -1))}>Убрать последнее</button>
          </div>
          <Button className="arena-primary" stretched loading={busy} disabled={busy || order.length !== choice.words.length}
            onClick={() => onMove({ move: "phrase", action, order })}>
            <span>{choice.label}{choice.damage !== undefined && attack.turn > 1 ? ` · до ${damage(choice.damage)} HP` : ""}</span>
          </Button>
        </>
      )}
    </>
  );
}

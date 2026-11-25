import type { ReactNode } from "react";

/**
 * Иконки вместо эмодзи: тонкий штрих, а не картинка. Штрих рисуется `currentColor`, поэтому иконка
 * принимает цвет того, на чём стоит: в тёмной теме — белая, в светлой — тёмная (см. `body` в styles.css).
 * Эмодзи этого не умеет: у них свой цвет, и на тёмном фоне они то не видны, то кричат.
 */
function Svg({ size = 20, className, children }: { size?: number; className?: string; children: ReactNode }) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number; className?: string };

/** ☰ — открыть меню. */
export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

/** ✕ — закрыть. */
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

/** Стрелка вниз — раскрыть. */
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Svg>
);

/** Стрелка вверх — свернуть. */
export const IconChevronUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 14.5l6-6 6 6" />
  </Svg>
);

/** Отменить последнее действие. */
export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5L4 10l5 5" />
    <path d="M4 10h9a5 5 0 0 1 0 10H8" />
  </Svg>
);

/** Карандаш — правка. */
export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h3.5L20 7.5 16.5 4 4 16.5V20z" />
    <path d="M14.5 6l3.5 3.5" />
  </Svg>
);

/** Плюс — добавить. */
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

/** Коробка — готовые наборы слов. */
export const IconBox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8 4.4v9.2L12 21l-8-4.4V7.4L12 3z" />
    <path d="M4 7.4l8 4.4 8-4.4M12 11.8V21" />
  </Svg>
);

/** Динамик — озвучка. */
export const IconSpeaker = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5h3L11 6v12l-4-3.5H4z" />
    <path d="M15 9.5a3.5 3.5 0 0 1 0 5" />
    <path d="M17.5 7a7 7 0 0 1 0 10" />
  </Svg>
);

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);

export const IconHeadphones = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="4" y="13" width="4" height="6" rx="1.5" />
    <rect x="16" y="13" width="4" height="6" rx="1.5" />
  </Svg>
);

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3zM12 8v7m-3-3h6" />
  </Svg>
);

export const IconChart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4v16h16M8 15v-3m5 3V8m5 7V5" />
  </Svg>
);

export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 6c-2.5-2-5.5-2-9-1v13c3.5-1 6.5-1 9 1 2.5-2 5.5-2 9-1V5c-3.5-1-6.5-1-9 1v13" />
  </Svg>
);

/**
 * Буквы «Aa» — грамматика.
 *
 * Раньше здесь стояла та же книга, что у «Слов», и в меню два пункта выглядели одинаково: понять,
 * куда ведёт каждый, можно было только по подписи. «Aa» — стандартный знак грамматики и не путается
 * ни с книгой-словарём, ни с карточками.
 *
 * Рисуется двумя элементами: заглавная A двумя штрихами с перекладиной и строчная a чашей со стойкой.
 * Строчная оставлена без хвостика — при 16 px он превращается в грязь.
 */
export const IconGrammar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 5.5L3.4 17.5" />
    <path d="M7 5.5l3.6 12" />
    <path d="M4.7 13h4.6" />
    <circle cx="16.6" cy="13.7" r="3.5" />
    <path d="M20 10.2V17.2" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h6m4 0h6M4 12h11m4 0h1M4 18h2m4 0h10M10 4v4m5 2v4m-9 2v4" />
  </Svg>
);

/** Галочка — верно / сделано. */
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
);

/** Крестик — неверно. */
export const IconCross = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);

/** Замок — трофей ещё не получен. */
export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);

/**
 * Иконка внутри кнопки telegram-ui: текст и иконка в одну строку по центру.
 * Цвет наследуется от кнопки, поэтому подходит и «залитой», и «плоской».
 */
export function ButtonIcon({ children }: { children: ReactNode }) {
  return <span className="btn-label">{children}</span>;
}

/**
 * Полезность слова — точка, а не эмодзи-кружок: 3 — очень полезное (зелёная), 2 — полезное (жёлтая),
 * 1 — необязательное (серая), не оценено — точки нет.
 */
export function UsefulDot({ level, className }: { level: number | null | undefined; className?: string }) {
  if (level !== 3 && level !== 2 && level !== 1) return null;
  const label = `Полезность: ${level} из 3`;
  return <span className={`useful-dot u${level}${className ? ` ${className}` : ""}`} title={label} role="img" aria-label={label} />;
}

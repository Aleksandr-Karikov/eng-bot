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

/** Лоток — новые слова от друзей. */
export const IconInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 13h4l1.5 3h5L16 13h4" />
    <path d="M4.5 13l2.2-7.4A1 1 0 0 1 7.7 5h8.6a1 1 0 0 1 1 .6L19.5 13V18a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-5z" />
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

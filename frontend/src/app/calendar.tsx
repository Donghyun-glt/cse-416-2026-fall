"use client";

import { useMemo, useState, useSyncExternalStore } from "react";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// Apple's calendars keep a fixed six-week grid so the layout never jumps when
// you page between months.
const WEEKS = 6;
const CELLS = WEEKS * 7;

// Apple system red, used for "today" the same way iOS/macOS Calendar does.
const APPLE_RED = "#ff3b30";

const APPLE_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function toKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// The current date never changes underneath us while the page is open, so
// there is nothing to subscribe to.
function subscribeToNothing() {
  return () => {};
}

function getTodayKey() {
  return toKey(new Date());
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "M15 5 8 12l7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

export function Calendar() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Server and client can disagree about what day it is, so "today" resolves
  // to null during SSR and hydration, then to the real date on the client.
  const todayKey = useSyncExternalStore(subscribeToNothing, getTodayKey, () => null);

  const days = useMemo(() => {
    const gridStart = new Date(cursor);
    gridStart.setDate(1 - cursor.getDay());

    return Array.from({ length: CELLS }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      return date;
    });
  }, [cursor]);

  const monthLabel = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
  }).format(cursor);

  const goToToday = () => {
    const now = new Date();
    setCursor(startOfMonth(now));
    setSelectedKey(toKey(now));
  };

  return (
    <section
      style={{ fontFamily: APPLE_FONT_STACK }}
      className="rounded-3xl border border-white/80 bg-white/88 p-8 shadow-sm backdrop-blur-md"
    >
      <header className="mb-7 flex items-center justify-between gap-2">
        <h2 className="text-[28px] font-semibold tracking-tight text-slate-900">
          {monthLabel}
        </h2>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goToToday}
            className="mr-2 rounded-full px-4 py-1.5 text-[15px] font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            오늘
          </button>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, -1))}
            aria-label="이전 달"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(addMonths(cursor, 1))}
            aria-label="다음 달"
            className="flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <ChevronIcon direction="right" />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-y-2">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="pb-3 text-center text-[15px] font-medium tracking-wide text-slate-400"
          >
            {weekday}
          </div>
        ))}

        {days.map((date) => {
          const key = toKey(date);
          const inMonth = date.getMonth() === cursor.getMonth();
          const isToday = key === todayKey;
          const isSelected = key === selectedKey;

          const tone = isSelected
            ? "text-white"
            : isToday
              ? "font-semibold"
              : inMonth
                ? "text-slate-700 hover:bg-slate-100"
                : "text-slate-300 hover:bg-slate-50";

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedKey(isSelected ? null : key)}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={isSelected}
              className={`mx-auto flex h-[68px] w-[68px] items-center justify-center rounded-full text-[21px] tabular-nums transition ${tone}`}
              style={{
                backgroundColor: isSelected
                  ? isToday
                    ? APPLE_RED
                    : "#1d1d1f"
                  : undefined,
                color: isToday && !isSelected ? APPLE_RED : undefined,
              }}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

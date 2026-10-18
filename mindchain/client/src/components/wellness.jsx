import { MOOD_EMOJI, MOOD_LABELS, moodColor, STRESS_LABELS, stressColor } from '../services/format.js';

// 1–10 mood picker rendered as a radio group (keyboard accessible).
export function MoodSelector({ value, onChange, error }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-700">How is your mood today?</legend>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-10" role="radiogroup">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
          const selected = value === n;
          return (
            <label
              key={n}
              className={`flex cursor-pointer flex-col items-center rounded-xl px-1 py-2 text-center ring-1 transition ${
                selected ? 'bg-brand-50 ring-2 ring-brand-600' : 'ring-slate-200 hover:bg-slate-50'
              }`}
              title={MOOD_LABELS[n]}
            >
              <input type="radio" name="mood" value={n} checked={selected} onChange={() => onChange(n)} className="sr-only" />
              <span className="text-2xl" aria-hidden="true">{MOOD_EMOJI[n]}</span>
              <span className="mt-1 text-xs font-medium text-slate-700">{n}</span>
              <span className="sr-only">{MOOD_LABELS[n]}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-slate-500">
        {value ? (
          <>
            Selected: <span className="font-medium text-slate-700">{MOOD_LABELS[value]}</span>
          </>
        ) : (
          '1 = very low, 10 = excellent'
        )}
      </p>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </fieldset>
  );
}

export function StressSlider({ value, onChange }) {
  const pct = ((value - 1) / 9) * 100;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor="stress" className="text-sm font-medium text-slate-700">
          Perceived stress
        </label>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${stressColor(value)}`}>
          {value} · {STRESS_LABELS[value]}
        </span>
      </div>
      <input
        id="stress"
        type="range"
        min="1"
        max="10"
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-700"
        style={{ background: `linear-gradient(to right, #0f766e ${pct}%, #e2e8f0 ${pct}%)` }}
        aria-valuetext={`${value}, ${STRESS_LABELS[value]}`}
      />
      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>Very relaxed</span>
        <span>Overwhelming</span>
      </div>
    </div>
  );
}

export function TagInput({ value, onChange, max = 10 }) {
  const add = (raw) => {
    const t = raw.trim().toLowerCase();
    if (!t || value.includes(t) || value.length >= max) return;
    if (!/^[\p{L}\p{N} _-]{1,30}$/u.test(t)) return;
    onChange([...value, t]);
  };
  return (
    <div>
      <label htmlFor="tags" className="mb-1 block text-sm font-medium text-slate-700">
        Tags <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2 py-2 ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-brand-500">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove tag ${t}`} className="text-brand-600 hover:text-brand-900">
              ×
            </button>
          </span>
        ))}
        <input
          id="tags"
          className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm focus:ring-0 focus:outline-none"
          placeholder={value.length >= max ? 'Tag limit reached' : 'e.g. sleep, work — press Enter'}
          disabled={value.length >= max}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(e.currentTarget.value);
              e.currentTarget.value = '';
            }
          }}
          onBlur={(e) => {
            add(e.currentTarget.value);
            e.currentTarget.value = '';
          }}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">Letters, numbers, spaces, - and _. Up to {max} tags.</p>
    </div>
  );
}

export function ScorePill({ kind, value }) {
  const cls = kind === 'mood' ? moodColor(value) : stressColor(value);
  const label = kind === 'mood' ? 'Mood' : 'Stress';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {kind === 'mood' && <span aria-hidden="true">{MOOD_EMOJI[value]}</span>}
      {label} {value ?? '—'}/10
    </span>
  );
}

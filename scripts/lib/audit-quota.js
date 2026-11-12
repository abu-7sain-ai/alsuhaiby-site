// audit-quota.js — pure date/quota maths for the daily audit task (owner, 2026-11-12). No I/O, so it is testable.
//   7 articles are owed per Kuwait day; missed days add 7 each, so the backlog recovers; never more than 21 owed in one run.
export const PER_DAY = 7;
export const CAP = 21;
export const kuwaitDay = (ms = Date.now()) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);
export const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** state = { lastDoneDate, lastAccrual, owed }. Returns { skip } when today is already done, else the new owed count. */
export function plan(state = {}, today = kuwaitDay()) {
  if (state.lastDoneDate === today) return { skip: true, why: 'today is already done', owed: 0 };
  const days = state.lastAccrual ? Math.max(0, dayDiff(state.lastAccrual, today)) : 1; // first ever run = one day's worth
  const owed = Math.min(CAP, (Number(state.owed) || 0) + PER_DAY * days);
  return { skip: false, owed, days, lastAccrual: today };
}

/** After a run that handled `handled` articles, with `left` auditable ones remaining → the next state. */
export function after(state, p, handled, left, today = kuwaitDay()) {
  const owed = Math.max(0, p.owed - handled);
  const done = owed === 0 || left === 0;
  return { ...state, lastAccrual: p.lastAccrual, owed: done ? 0 : owed, ...(done ? { lastDoneDate: today } : {}), done };
}

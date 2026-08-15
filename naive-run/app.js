'use strict';

const WEEKDAY_LABELS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEKDAY_LABELS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const SLOT_MINUTES = 30;
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES; // 48
// Intl weekday short codes -> Monday-based index (0=Mon..6=Sun)
const WEEKDAY_CODE_TO_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

let allTimeZones = [];
try {
  allTimeZones = Intl.supportedValuesOf('timeZone');
} catch (e) {
  // Fallback for browsers without supportedValuesOf — a small manual list keeps the app usable.
  allTimeZones = [
    'UTC', 'Europe/Moscow', 'Europe/London', 'Europe/Berlin', 'Europe/Kyiv',
    'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Sao_Paulo',
    'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Almaty', 'Asia/Novosibirsk',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney',
  ];
}
const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const state = {
  participants: [], // { id, name, timeZone, workStart, workEnd, days: [bool*7] }
  weekStart: null,  // plain Date holding the calendar components of Monday, 00:00 local (component-only use)
  refTimeZone: browserTimeZone,
  selectedSlot: null, // { dayIndex, slotIndex }
};

let nextParticipantId = 1;

// ---------------------------------------------------------------------------
// Timezone-aware conversion helpers (no external date libraries — Intl only)
// ---------------------------------------------------------------------------

function getZonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month) - 1,
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekdayIndex: WEEKDAY_CODE_TO_INDEX[map.weekday],
  };
}

// Converts a wall-clock time meant to be read in `timeZone` into the UTC instant
// it represents. Iterates because a timezone's UTC offset depends on the instant
// itself (DST), which is exactly what we're trying to find — a couple of passes
// converge even across DST transition boundaries.
function zonedWallTimeToUtc(wall, timeZone) {
  const target = Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, 0);
  let utcGuess = target;
  for (let i = 0; i < 3; i++) {
    const shown = getZonedParts(new Date(utcGuess), timeZone);
    const shownAsUtc = Date.UTC(shown.year, shown.month, shown.day, shown.hour, shown.minute, 0);
    // Compare against the fixed target wall time, not the shifting guess —
    // otherwise the correction keeps re-applying the offset instead of cancelling it.
    const diff = shownAsUtc - target;
    if (diff === 0) break;
    utcGuess -= diff;
  }
  return new Date(utcGuess);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatHM(hour, minute) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function isTimeZoneValid(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Availability calculation
// ---------------------------------------------------------------------------

function isParticipantAvailable(participant, utcInstant) {
  const parts = getZonedParts(utcInstant, participant.timeZone);
  if (!participant.days[parts.weekdayIndex]) return false;
  const minutesOfDay = parts.hour * 60 + parts.minute;
  const startMin = toMinutes(participant.workStart);
  const endMin = toMinutes(participant.workEnd);
  return minutesOfDay >= startMin && minutesOfDay < endMin;
}

function computeGrid() {
  const monday = state.weekStart;
  const grid = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const y = monday.getFullYear();
    const m = monday.getMonth();
    const d = monday.getDate() + dayIndex;
    const col = [];
    for (let slotIndex = 0; slotIndex < SLOTS_PER_DAY; slotIndex++) {
      const totalMinutes = slotIndex * SLOT_MINUTES;
      const hour = Math.floor(totalMinutes / 60);
      const minute = totalMinutes % 60;
      const utcInstant = zonedWallTimeToUtc(
        { year: y, month: m, day: d, hour, minute },
        state.refTimeZone
      );
      const statuses = state.participants.map((p) => isParticipantAvailable(p, utcInstant));
      const count = statuses.filter(Boolean).length;
      col.push({ utc: utcInstant, statuses, count, total: state.participants.length, hour, minute });
    }
    grid.push(col);
  }
  return grid;
}

function findBestWindows(grid) {
  const total = state.participants.length;
  const windows = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    let runStart = null;
    let runCount = null;
    for (let slotIndex = 0; slotIndex <= SLOTS_PER_DAY; slotIndex++) {
      const cell = slotIndex < SLOTS_PER_DAY ? grid[dayIndex][slotIndex] : null;
      const c = cell ? cell.count : -1;
      if (runStart === null) {
        runStart = slotIndex;
        runCount = c;
      } else if (c !== runCount) {
        if (runCount > 0) {
          windows.push({ dayIndex, startSlot: runStart, endSlot: slotIndex, count: runCount, total });
        }
        runStart = slotIndex;
        runCount = c;
      }
    }
  }
  windows.sort((a, b) => (b.count - a.count) || ((b.endSlot - b.startSlot) - (a.endSlot - a.startSlot)));
  return windows.slice(0, 8);
}

function slotIndexToTime(slotIndex) {
  const totalMinutes = slotIndex * SLOT_MINUTES;
  return formatHM(Math.floor(totalMinutes / 60), totalMinutes % 60);
}

// ---------------------------------------------------------------------------
// DOM population — static parts
// ---------------------------------------------------------------------------

function populateTimeZoneSelect(selectEl, defaultValue) {
  selectEl.innerHTML = '';
  for (const tz of allTimeZones) {
    const opt = document.createElement('option');
    opt.value = tz;
    opt.textContent = tz.replace(/_/g, ' ');
    selectEl.appendChild(opt);
  }
  if (defaultValue && allTimeZones.includes(defaultValue)) {
    selectEl.value = defaultValue;
  }
}

function populateWeekdayChecks() {
  const container = document.getElementById('weekday-checks');
  container.innerHTML = '';
  WEEKDAY_LABELS_SHORT.forEach((label, idx) => {
    const wrapper = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(idx);
    checkbox.checked = idx < 5; // Mon-Fri by default
    checkbox.className = 'weekday-checkbox';
    wrapper.appendChild(checkbox);
    wrapper.appendChild(document.createTextNode(label));
    container.appendChild(wrapper);
  });
}

function defaultWeekStartInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  renderParticipantList();

  const hasParticipants = state.participants.length > 0;
  document.getElementById('panel-empty').hidden = hasParticipants;
  document.getElementById('panel-grid').hidden = !hasParticipants;
  document.getElementById('panel-best').hidden = !hasParticipants;
  document.getElementById('panel-detail').hidden = !state.selectedSlot;

  if (!hasParticipants) {
    state.selectedSlot = null;
    return;
  }

  const grid = computeGrid();
  renderGrid(grid);
  renderBestWindows(grid);
  renderSlotDetail(grid);
}

function renderParticipantList() {
  const list = document.getElementById('participant-list');
  const emptyHint = document.getElementById('participants-empty-hint');
  list.innerHTML = '';
  emptyHint.hidden = state.participants.length > 0;

  for (const p of state.participants) {
    const li = document.createElement('li');
    li.className = 'participant-card';

    const info = document.createElement('div');
    const main = document.createElement('div');
    main.className = 'p-main';
    main.textContent = p.name;
    const meta = document.createElement('div');
    meta.className = 'p-meta';
    const days = p.days.map((on, i) => (on ? WEEKDAY_LABELS_SHORT[i] : null)).filter(Boolean).join(', ') || 'нет рабочих дней';
    meta.textContent = `${p.timeZone.replace(/_/g, ' ')} · ${p.workStart}–${p.workEnd} · ${days}`;
    info.appendChild(main);
    info.appendChild(meta);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Удалить';
    removeBtn.addEventListener('click', () => {
      state.participants = state.participants.filter((x) => x.id !== p.id);
      state.selectedSlot = null;
      render();
    });

    li.appendChild(info);
    li.appendChild(removeBtn);
    list.appendChild(li);
  }
}

function colorForRatio(ratio) {
  if (ratio <= 0) return 'var(--slot-empty)';
  // interpolate from light blue to solid accent
  const start = { r: 238, g: 240, b: 245 };
  const end = { r: 47, g: 111, b: 237 };
  const r = Math.round(start.r + (end.r - start.r) * ratio);
  const g = Math.round(start.g + (end.g - start.g) * ratio);
  const b = Math.round(start.b + (end.b - start.b) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

function renderGrid(grid) {
  const container = document.getElementById('availability-grid');
  container.innerHTML = '';
  container.style.gridTemplateRows = `28px repeat(${SLOTS_PER_DAY}, 12px)`;

  // header row
  const corner = document.createElement('div');
  corner.className = 'grid-cell grid-head';
  container.appendChild(corner);

  const monday = state.weekStart;
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIndex);
    const head = document.createElement('div');
    head.className = 'grid-cell grid-head';
    head.textContent = `${WEEKDAY_LABELS_SHORT[dayIndex]} ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
    container.appendChild(head);
  }

  for (let slotIndex = 0; slotIndex < SLOTS_PER_DAY; slotIndex++) {
    const timeLabel = document.createElement('div');
    timeLabel.className = 'grid-cell grid-time-label';
    timeLabel.textContent = slotIndex % 2 === 0 ? slotIndexToTime(slotIndex) : '';
    container.appendChild(timeLabel);

    for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
      const cellData = grid[dayIndex][slotIndex];
      const cell = document.createElement('div');
      cell.className = 'grid-cell grid-slot';
      const ratio = cellData.total > 0 ? cellData.count / cellData.total : 0;
      cell.style.background = colorForRatio(ratio);
      cell.title = `${WEEKDAY_LABELS_FULL[dayIndex]} ${slotIndexToTime(slotIndex)} — доступно ${cellData.count} из ${cellData.total}`;
      if (state.selectedSlot && state.selectedSlot.dayIndex === dayIndex && state.selectedSlot.slotIndex === slotIndex) {
        cell.classList.add('selected');
      }
      cell.addEventListener('click', () => {
        state.selectedSlot = { dayIndex, slotIndex };
        render();
      });
      container.appendChild(cell);
    }
  }
}

function renderBestWindows(grid) {
  const total = state.participants.length;
  const windows = findBestWindows(grid);
  const bestList = document.getElementById('best-list');
  bestList.innerHTML = '';

  const hasFullMatch = windows.some((w) => w.count === total);
  document.getElementById('no-full-match-banner').hidden = hasFullMatch || windows.length === 0;

  if (windows.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Нет ни одного слота, когда доступен хотя бы один участник — проверьте рабочие часы и дни.';
    bestList.appendChild(li);
    return;
  }

  const monday = state.weekStart;
  for (const w of windows) {
    const li = document.createElement('li');
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + w.dayIndex);
    const dateLabel = `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
    const timeFrom = slotIndexToTime(w.startSlot);
    const timeTo = slotIndexToTime(w.endSlot);
    const main = document.createElement('div');
    main.textContent = `${WEEKDAY_LABELS_FULL[w.dayIndex]}, ${dateLabel}, ${timeFrom}–${timeTo} (${state.refTimeZone.replace(/_/g, ' ')})`;
    const meta = document.createElement('div');
    meta.className = 'best-meta';
    meta.textContent = w.count === total
      ? `Доступны все ${total} участников`
      : `Доступны ${w.count} из ${total} участников`;
    li.appendChild(main);
    li.appendChild(meta);
    bestList.appendChild(li);
  }
}

function renderSlotDetail(grid) {
  const container = document.getElementById('slot-detail');
  container.innerHTML = '';
  if (!state.selectedSlot) return;

  const { dayIndex, slotIndex } = state.selectedSlot;
  const cellData = grid[dayIndex][slotIndex];

  const heading = document.createElement('p');
  heading.innerHTML = `<strong>${WEEKDAY_LABELS_FULL[dayIndex]}, ${slotIndexToTime(slotIndex)} (${state.refTimeZone.replace(/_/g, ' ')})</strong> — доступно ${cellData.count} из ${cellData.total}`;
  container.appendChild(heading);

  const table = document.createElement('table');
  const thead = document.createElement('tr');
  thead.innerHTML = '<th>Участник</th><th>Локальное время</th><th>Статус</th>';
  table.appendChild(thead);

  state.participants.forEach((p, i) => {
    const parts = getZonedParts(cellData.utc, p.timeZone);
    const row = document.createElement('tr');
    const available = cellData.statuses[i];
    row.innerHTML = `
      <td>${p.name}</td>
      <td>${WEEKDAY_LABELS_SHORT[parts.weekdayIndex]} ${formatHM(parts.hour, parts.minute)}</td>
      <td class="${available ? 'status-yes' : 'status-no'}">${available ? 'доступен' : 'недоступен'}</td>
    `;
    table.appendChild(row);
  });

  container.appendChild(table);
}

// ---------------------------------------------------------------------------
// Form handling
// ---------------------------------------------------------------------------

function showFormError(message) {
  const el = document.getElementById('form-error');
  el.textContent = message;
  el.hidden = false;
}

function clearFormError() {
  const el = document.getElementById('form-error');
  el.hidden = true;
  el.textContent = '';
}

function handleParticipantSubmit(evt) {
  evt.preventDefault();
  clearFormError();

  const name = document.getElementById('input-name').value.trim();
  const timeZone = document.getElementById('input-timezone').value;
  const workStart = document.getElementById('input-work-start').value;
  const workEnd = document.getElementById('input-work-end').value;
  const dayCheckboxes = Array.from(document.querySelectorAll('.weekday-checkbox'));
  const days = dayCheckboxes.map((cb) => cb.checked);

  if (!name) {
    showFormError('Укажите имя участника.');
    return;
  }
  if (!timeZone || !isTimeZoneValid(timeZone)) {
    showFormError('Выберите корректный часовой пояс из списка.');
    return;
  }
  if (!workStart || !workEnd) {
    showFormError('Укажите начало и конец рабочего дня.');
    return;
  }
  if (toMinutes(workStart) >= toMinutes(workEnd)) {
    showFormError('Начало рабочего дня должно быть раньше конца. Смены через полночь пока не поддерживаются.');
    return;
  }
  if (!days.some(Boolean)) {
    showFormError('Отметьте хотя бы один рабочий день.');
    return;
  }

  state.participants.push({
    id: nextParticipantId++,
    name,
    timeZone,
    workStart,
    workEnd,
    days,
  });

  document.getElementById('participant-form').reset();
  document.getElementById('input-work-start').value = '09:00';
  document.getElementById('input-work-end').value = '18:00';
  populateWeekdayChecks();
  populateTimeZoneSelect(document.getElementById('input-timezone'), browserTimeZone);

  render();
}

function handleWeekChange(evt) {
  const value = evt.target.value;
  if (!value) return;
  state.weekStart = getMondayOfWeek(value);
  state.selectedSlot = null;
  render();
}

function getMondayOfWeek(isoDateStr) {
  const [y, m, d] = isoDateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const jsDay = dt.getDay(); // 0=Sun..6=Sat
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1=Mon..7=Sun
  dt.setDate(dt.getDate() - (isoDay - 1));
  return dt;
}

function handleRefTimeZoneChange(evt) {
  const tz = evt.target.value;
  if (!isTimeZoneValid(tz)) return;
  state.refTimeZone = tz;
  state.selectedSlot = null;
  render();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  populateTimeZoneSelect(document.getElementById('input-timezone'), browserTimeZone);
  populateTimeZoneSelect(document.getElementById('input-ref-timezone'), browserTimeZone);
  populateWeekdayChecks();

  const weekInput = document.getElementById('input-week');
  weekInput.value = defaultWeekStartInputValue();
  state.weekStart = getMondayOfWeek(weekInput.value);

  document.getElementById('participant-form').addEventListener('submit', handleParticipantSubmit);
  weekInput.addEventListener('change', handleWeekChange);
  document.getElementById('input-ref-timezone').addEventListener('change', handleRefTimeZoneChange);

  render();
}

document.addEventListener('DOMContentLoaded', init);

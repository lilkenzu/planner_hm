'use strict';

// Рабочие дни хранятся в конвенции Date.getDay(): 0 = вс, 1 = пн, ... 6 = сб.
// В UI показываем в порядке пн..вс, потому что так привычнее читать.
const WEEKDAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
];
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

const ALL_TIME_ZONES = Intl.supportedValuesOf('timeZone');

function timeZoneCityLabel(zone) {
  const parts = zone.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

function findTimeZoneMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_TIME_ZONES
    .filter((zone) => timeZoneCityLabel(zone).toLowerCase().includes(q) || zone.toLowerCase().includes(q))
    .slice(0, 8);
}

const DAY_BLOCK_SIZE = 48; // 24 ч × 2 слота/ч — совпадает с дефолтными опциями Availability.buildWeekGrid
const SLOT_MINUTES = 30;

// «Сейчас» почти никогда не приходится ровно на границу получаса — без этого
// слоты выглядели бы как 06:43–07:13 вместо 06:30–07:00. Округляем вверх по
// UTC: для поясов с целым/получасовым смещением (Москва, Лондон) это даёт
// ровные :00/:30, а Катманду (+5:45) всё равно покажет :15/:45 — это не баг
// округления, а свойство самого 45-минутного сдвига, его так и не обойти.
function roundUpToSlotBoundary(date, slotMinutes) {
  const ms = slotMinutes * 60000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

const state = {
  participants: [],
  editingId: null,
  selectedTimeZone: null,
  nextId: 1,
  // Фиксируется один раз при открытии страницы, чтобы сетка не «уезжала»
  // вперёд при каждом пересчёте (добавление/правка/удаление участника).
  rangeStart: roundUpToSlotBoundary(new Date(), SLOT_MINUTES),
  grid: null,
  selectedSlotIndex: null,
};

const form = document.getElementById('participant-form');
const nameInput = document.getElementById('name-input');
const nameError = document.getElementById('name-error');
const cityInput = document.getElementById('city-input');
const cityError = document.getElementById('city-error');
const citySuggestions = document.getElementById('city-suggestions');
const startTimeInput = document.getElementById('start-time');
const endTimeInput = document.getElementById('end-time');
const timeError = document.getElementById('time-error');
const daysGrid = document.getElementById('days-grid');
const submitBtn = document.getElementById('submit-btn');
const cancelBtn = document.getElementById('cancel-btn');
const participantsList = document.getElementById('participants-list');
const gridSection = document.getElementById('grid-section');
const gridContainer = document.getElementById('grid-container');
const slotDetail = document.getElementById('slot-detail');
const noMatchBanner = document.getElementById('no-match-banner');

function renderDaysCheckboxes(selectedDays) {
  daysGrid.innerHTML = '';
  WEEKDAYS.forEach((day) => {
    const id = `day-${day.value}`;
    const wrapper = document.createElement('label');
    wrapper.className = 'day-checkbox';
    wrapper.setAttribute('for', id);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.value = String(day.value);
    checkbox.checked = selectedDays.includes(day.value);

    wrapper.appendChild(checkbox);
    wrapper.appendChild(document.createTextNode(day.label));
    daysGrid.appendChild(wrapper);
  });
}

function getSelectedDays() {
  return WEEKDAYS
    .map((day) => day.value)
    .filter((value) => daysGrid.querySelector(`#day-${value}`).checked);
}

function clearErrors() {
  nameError.textContent = '';
  cityError.textContent = '';
  timeError.textContent = '';
}

function hideSuggestions() {
  citySuggestions.hidden = true;
  citySuggestions.innerHTML = '';
}

function selectTimeZone(zone) {
  state.selectedTimeZone = zone;
  cityInput.value = `${timeZoneCityLabel(zone)} (${zone})`;
  hideSuggestions();
}

cityInput.addEventListener('input', () => {
  // Любое ручное изменение текста сбрасывает подтверждённый выбор —
  // участник не добавится, пока пользователь не кликнет по варианту из списка.
  state.selectedTimeZone = null;

  const matches = findTimeZoneMatches(cityInput.value);
  if (matches.length === 0) {
    hideSuggestions();
    return;
  }

  citySuggestions.innerHTML = '';
  matches.forEach((zone) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'suggestion-option';
    option.textContent = `${timeZoneCityLabel(zone)} — ${zone}`;
    option.addEventListener('click', () => selectTimeZone(zone));
    citySuggestions.appendChild(option);
  });
  citySuggestions.hidden = false;
});

document.addEventListener('click', (event) => {
  if (!citySuggestions.contains(event.target) && event.target !== cityInput) {
    hideSuggestions();
  }
});

function resetForm() {
  form.reset();
  startTimeInput.value = '09:00';
  endTimeInput.value = '18:00';
  renderDaysCheckboxes(DEFAULT_WORK_DAYS);
  state.selectedTimeZone = null;
  state.editingId = null;
  submitBtn.textContent = 'Добавить участника';
  cancelBtn.hidden = true;
  clearErrors();
  hideSuggestions();
}

function startEditing(participant) {
  state.editingId = participant.id;
  state.selectedTimeZone = participant.timeZone;
  nameInput.value = participant.name;
  cityInput.value = `${timeZoneCityLabel(participant.timeZone)} (${participant.timeZone})`;
  startTimeInput.value = participant.startTime;
  endTimeInput.value = participant.endTime;
  renderDaysCheckboxes(participant.days);
  submitBtn.textContent = 'Сохранить участника';
  cancelBtn.hidden = false;
  clearErrors();
  hideSuggestions();
  nameInput.focus();
}

cancelBtn.addEventListener('click', resetForm);

function validateForm() {
  clearErrors();
  let valid = true;

  if (!nameInput.value.trim()) {
    nameError.textContent = 'Введите имя участника.';
    valid = false;
  }

  if (!state.selectedTimeZone) {
    cityError.textContent = 'Город не распознан. Выберите вариант из списка подсказок.';
    valid = false;
  }

  if (startTimeInput.value && endTimeInput.value && startTimeInput.value >= endTimeInput.value) {
    timeError.textContent = 'Начало рабочего дня должно быть раньше окончания.';
    valid = false;
  }

  if (getSelectedDays().length === 0) {
    timeError.textContent = 'Отметьте хотя бы один рабочий день.';
    valid = false;
  }

  return valid;
}

function renderParticipants() {
  participantsList.innerHTML = '';

  if (state.participants.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'Пока нет ни одного участника — добавьте первого через форму слева.';
    participantsList.appendChild(empty);
    return;
  }

  state.participants.forEach((participant) => {
    const card = document.createElement('article');
    card.className = 'participant-card';

    const daysLabel = WEEKDAYS
      .filter((day) => participant.days.includes(day.value))
      .map((day) => day.label)
      .join(', ');

    card.innerHTML = `
      <div class="participant-info">
        <strong>${escapeHtml(participant.name)}</strong>
        <span>${escapeHtml(timeZoneCityLabel(participant.timeZone))} (${escapeHtml(participant.timeZone)})</span>
        <span>${escapeHtml(participant.startTime)}–${escapeHtml(participant.endTime)}, ${escapeHtml(daysLabel)}</span>
      </div>
      <div class="participant-actions">
        <button type="button" class="edit-btn">Изменить</button>
        <button type="button" class="delete-btn">Удалить</button>
      </div>
    `;

    card.querySelector('.edit-btn').addEventListener('click', () => startEditing(participant));
    card.querySelector('.delete-btn').addEventListener('click', () => deleteParticipant(participant.id));

    participantsList.appendChild(card);
  });
}

function deleteParticipant(id) {
  state.participants = state.participants.filter((participant) => participant.id !== id);
  if (state.editingId === id) {
    resetForm();
  }
  refresh();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

// 0% -> красный (hue 0), 100% -> зелёный (hue 120). Общая заливка ячейки —
// не по конкретному участнику, а по доле доступных из всех.
function percentToColor(percent) {
  const hue = Math.round((percent / 100) * 120);
  return `hsl(${hue}, 65%, 45%)`;
}

function formatDiffMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} мин`;
  if (mins === 0) return `${hours} ч`;
  return `${hours} ч ${mins} мин`;
}

function reasonText(detail) {
  if (detail.available) return 'доступен(на)';
  if (detail.reason === 'day-off') return 'нерабочий день';
  if (detail.reason === 'before-start') return `рабочий день начнётся через ${formatDiffMinutes(detail.diffMinutes)}`;
  if (detail.reason === 'after-end') return `рабочий день закончился ${formatDiffMinutes(detail.diffMinutes)} назад`;
  return '';
}

// Подпись блока дня — в часовом поясе устройства зрителя (Intl без явного
// timeZone берёт его сам): нейтральный ориентир, не привязанный ни к одному
// конкретному участнику, чтобы не выдавать чей-то пояс за общий.
function dayBlockLabel(date) {
  const label = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Полный формат момента для баннера «нет совпадения» — та же нейтральная
// (не привязанная к участнику) метка, что и заголовок блока дня, плюс время.
function slotMomentLabel(date) {
  const label = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Первый хронологически слот с максимальным процентом — строгое ">"
// оставляет самый ранний при равенстве, а не последний.
function findBestSlotIndex(grid) {
  let bestIndex = 0;
  for (let i = 1; i < grid.length; i++) {
    if (grid[i].percent > grid[bestIndex].percent) bestIndex = i;
  }
  return bestIndex;
}

function renderGrid() {
  gridContainer.innerHTML = '';
  slotDetail.innerHTML = '';
  state.selectedSlotIndex = null;
  state.grid = null;

  if (state.participants.length === 0) {
    gridSection.hidden = true;
    return;
  }
  gridSection.hidden = false;

  const grid = Availability.buildWeekGrid(state.participants, state.rangeStart);
  state.grid = grid;

  const bestIndex = findBestSlotIndex(grid);
  const hasFullMatch = grid[bestIndex].percent === 100;

  if (hasFullMatch) {
    noMatchBanner.hidden = true;
    noMatchBanner.onclick = null;
  } else {
    const bestSlot = grid[bestIndex];
    noMatchBanner.hidden = false;
    noMatchBanner.textContent =
      `Полного совпадения на этой неделе нет. Лучший вариант — ${slotMomentLabel(bestSlot.slotStart)}: ` +
      `доступно ${bestSlot.availableCount} из ${bestSlot.total} (${bestSlot.percent}%). Нажмите, чтобы посмотреть подробности.`;
    // onclick, а не addEventListener — renderGrid перевызывается на каждое
    // изменение состава участников, а noMatchBanner не пересоздаётся заново
    // (в отличие от ячеек), addEventListener бы копил обработчики.
    noMatchBanner.onclick = () => showSlotDetail(bestIndex);
  }

  for (let day = 0; day < 7; day++) {
    const dayStartIndex = day * DAY_BLOCK_SIZE;

    const block = document.createElement('div');
    block.className = 'day-block';

    const header = document.createElement('div');
    header.className = 'day-block-header';
    header.textContent = dayBlockLabel(grid[dayStartIndex].slotStart);
    block.appendChild(header);

    const rows = document.createElement('div');
    rows.className = 'day-block-rows';

    state.participants.forEach((participant) => {
      const row = document.createElement('div');
      row.className = 'day-row';

      const name = document.createElement('span');
      name.className = 'day-row-name';
      name.textContent = participant.name;
      row.appendChild(name);

      const cells = document.createElement('div');
      cells.className = 'day-row-cells';

      for (let i = 0; i < DAY_BLOCK_SIZE; i++) {
        const slotIndex = dayStartIndex + i;
        const slot = grid[slotIndex];
        const parts = Availability.getZonedDateParts(slot.slotStart, participant.timeZone);
        const hh = String(parts.hour).padStart(2, '0');
        const mm = String(parts.minute).padStart(2, '0');

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'slot-cell';
        if (!hasFullMatch && slotIndex === bestIndex) {
          cell.classList.add('slot-cell--best');
        }
        cell.style.background = percentToColor(slot.percent);
        const label = `${participant.name}: ${hh}:${mm} — доступно ${slot.availableCount} из ${slot.total} (${slot.percent}%)`;
        cell.title = label;
        cell.setAttribute('aria-label', label);
        cell.addEventListener('click', () => showSlotDetail(slotIndex));
        cells.appendChild(cell);
      }

      row.appendChild(cells);
      rows.appendChild(row);
    });

    block.appendChild(rows);
    gridContainer.appendChild(block);
  }
}

function showSlotDetail(slotIndex) {
  state.selectedSlotIndex = slotIndex;
  const slot = state.grid[slotIndex];

  const items = state.participants.map((participant) => {
    const detail = slot.details.find((item) => item.participantId === participant.id);
    const parts = Availability.getZonedDateParts(slot.slotStart, participant.timeZone);
    const hh = String(parts.hour).padStart(2, '0');
    const mm = String(parts.minute).padStart(2, '0');
    const statusClass = detail.available ? 'slot-detail-ok' : 'slot-detail-bad';
    return `<li class="${statusClass}"><strong>${escapeHtml(participant.name)}</strong> — ${escapeHtml(reasonText(detail))} <span class="slot-detail-time">(его время: ${hh}:${mm})</span></li>`;
  }).join('');

  slotDetail.innerHTML = `
    <h3>Доступно ${slot.availableCount} из ${slot.total} (${slot.percent}%)</h3>
    <ul class="slot-detail-list">${items}</ul>
  `;
}

function refresh() {
  renderParticipants();
  renderGrid();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validateForm()) return;

  const payload = {
    name: nameInput.value.trim(),
    timeZone: state.selectedTimeZone,
    startTime: startTimeInput.value,
    endTime: endTimeInput.value,
    days: getSelectedDays(),
  };

  if (state.editingId) {
    const index = state.participants.findIndex((participant) => participant.id === state.editingId);
    state.participants[index] = { ...state.participants[index], ...payload };
  } else {
    state.participants.push({ id: state.nextId++, ...payload });
  }

  resetForm();
  refresh();
});

renderDaysCheckboxes(DEFAULT_WORK_DAYS);
refresh();

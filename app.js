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

const state = {
  participants: [],
  editingId: null,
  selectedTimeZone: null,
  nextId: 1,
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
  renderParticipants();
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
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
  renderParticipants();
});

renderDaysCheckboxes(DEFAULT_WORK_DAYS);
renderParticipants();

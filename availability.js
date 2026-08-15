(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Availability = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Разбирает произвольный UTC-момент (Date) на календарную дату, час и минуту
  // в заданном часовом поясе IANA — только встроенный Intl, без библиотек.
  // weekday возвращается в конвенции Date.getDay(): 0 = вс, 1 = пн, ... 6 = сб.
  function getZonedDateParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23', // явный 00-23, чтобы не словить квирк "24" в полночь
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const raw = {};
    for (const part of formatter.formatToParts(date)) {
      if (part.type !== 'literal') raw[part.type] = Number(part.value);
    }

    // День недели считаем через Date.UTC от локальных Y/M/D, а не парсингом
    // названия дня из локали — так не зависим от локали форматирования.
    const weekday = new Date(Date.UTC(raw.year, raw.month - 1, raw.day)).getUTCDay();

    return {
      year: raw.year,
      month: raw.month,
      day: raw.day,
      hour: raw.hour % 24,
      minute: raw.minute,
      weekday,
    };
  }

  function getZonedMinutesOfDay(date, timeZone) {
    const parts = getZonedDateParts(date, timeZone);
    return parts.hour * 60 + parts.minute;
  }

  // "09:00" -> 540
  function timeStringToMinutes(value) {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Доступность одного участника в один получасовой слот. Правило границ —
  // полуоткрытый интервал [начало, конец): сравниваем локальные минуты слота
  // (его начало) с рабочим диапазоном. Слот 17:30-18:00 при конце 18:00
  // доступен (17:30 < 18:00), слот 18:00-18:30 — уже нет (18:00 не < 18:00).
  function computeParticipantSlot(participant, slotStart) {
    const parts = getZonedDateParts(slotStart, participant.timeZone);
    const minutesOfDay = parts.hour * 60 + parts.minute;
    const startMinutes = timeStringToMinutes(participant.startTime);
    const endMinutes = timeStringToMinutes(participant.endTime);

    if (!participant.days.includes(parts.weekday)) {
      return { participantId: participant.id, available: false, reason: 'day-off' };
    }
    if (minutesOfDay < startMinutes) {
      return {
        participantId: participant.id,
        available: false,
        reason: 'before-start',
        diffMinutes: startMinutes - minutesOfDay,
      };
    }
    if (minutesOfDay >= endMinutes) {
      return {
        participantId: participant.id,
        available: false,
        reason: 'after-end',
        diffMinutes: minutesOfDay - endMinutes,
      };
    }
    return { participantId: participant.id, available: true };
  }

  // Доступность всех участников в один слот: доля (округлённая до целого
  // процента) + подробности по каждому недоступному — для будущего клика
  // по ячейке (шаг 4).
  function computeSlotAvailability(participants, slotStart) {
    const details = participants.map((participant) => computeParticipantSlot(participant, slotStart));
    const availableCount = details.filter((detail) => detail.available).length;
    const total = participants.length;
    const percent = total === 0 ? 0 : Math.round((availableCount / total) * 100);
    return { slotStart, availableCount, total, percent, details };
  }

  // Сетка слотов на заданное число дней вперёд от rangeStart (по умолчанию —
  // 7 дней по 30 минут = 336 слотов), с реальными календарными датами.
  function buildWeekGrid(participants, rangeStart, options) {
    const slotMinutes = (options && options.slotMinutes) || 30;
    const days = (options && options.days) || 7;
    const totalSlots = Math.round((days * 24 * 60) / slotMinutes);

    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      const slotStart = new Date(rangeStart.getTime() + i * slotMinutes * 60000);
      slots.push(computeSlotAvailability(participants, slotStart));
    }
    return slots;
  }

  return {
    getZonedDateParts,
    getZonedMinutesOfDay,
    timeStringToMinutes,
    computeParticipantSlot,
    computeSlotAvailability,
    buildWeekGrid,
  };
});

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

  return { getZonedDateParts, getZonedMinutesOfDay };
});

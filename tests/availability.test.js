'use strict';

const { getZonedDateParts } = require('../availability.js');

let failures = 0;

function check(condition, message) {
  console.assert(condition, message);
  if (!condition) failures++;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Независимая перекрёстная проверка: другой вызов Intl (формат "en-US" со
// строковым weekday вместо ручного пересчёта через Date.UTC), сравниваем поля
// по отдельности, а не строку целиком — так тест не зависит от пунктуации
// локали (запятая после дня недели и т.п.), только от факта совпадения часа,
// минуты и дня недели.
function crossCheckParts(date, timeZone) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return {
    weekdayName: parts.weekday,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function labelFromParts(parts) {
  const hh = String(parts.hour).padStart(2, '0');
  const mm = String(parts.minute).padStart(2, '0');
  return `${WEEKDAY_SHORT[parts.weekday]} ${hh}:${mm}`;
}

console.log('--- Шаг 2: локальное время участника (getZonedDateParts) ---');

// Кейс 1: Катманду (UTC+5:45), переход через полночь местного времени.
// 19:00 UTC + 5:45 = 24:45 -> следующий календарный день, 00:45.
{
  const date = new Date('2026-08-16T19:00:00Z');
  const parts = getZonedDateParts(date, 'Asia/Kathmandu');
  const cross = crossCheckParts(date, 'Asia/Kathmandu');

  check(parts.hour === 0, `Катманду, переход через полночь: час должен быть 0, получили ${parts.hour}`);
  check(parts.minute === 45, `Катманду, переход через полночь: минуты должны быть 45, получили ${parts.minute}`);
  check(parts.hour === cross.hour && parts.minute === cross.minute,
    `Катманду, переход через полночь: час/минута расходятся с перекрёстной проверкой (${parts.hour}:${parts.minute} vs ${cross.hour}:${cross.minute})`);
  check(WEEKDAY_SHORT[parts.weekday] === cross.weekdayName,
    `Катманду, переход через полночь: день недели расходится с перекрёстной проверкой (${WEEKDAY_SHORT[parts.weekday]} vs ${cross.weekdayName})`);
  console.log(`UTC 2026-08-16T19:00:00Z -> Катманду: ${labelFromParts(parts)} (перекрёстно: ${cross.weekdayName} ${String(cross.hour).padStart(2,'0')}:${String(cross.minute).padStart(2,'0')})`);
}

// Кейс 2: Катманду, тот же календарный день (без перехода через полночь).
// 06:00 UTC + 5:45 = 11:45, тот же день.
{
  const date = new Date('2026-08-16T06:00:00Z');
  const parts = getZonedDateParts(date, 'Asia/Kathmandu');
  const cross = crossCheckParts(date, 'Asia/Kathmandu');

  check(parts.hour === 11, `Катманду, будний слот: час должен быть 11, получили ${parts.hour}`);
  check(parts.minute === 45, `Катманду, будний слот: минуты должны быть 45, получили ${parts.minute}`);
  check(parts.hour === cross.hour && parts.minute === cross.minute,
    `Катманду, будний слот: час/минута расходятся с перекрёстной проверкой (${parts.hour}:${parts.minute} vs ${cross.hour}:${cross.minute})`);
  check(WEEKDAY_SHORT[parts.weekday] === cross.weekdayName,
    `Катманду, будний слот: день недели расходится с перекрёстной проверкой (${WEEKDAY_SHORT[parts.weekday]} vs ${cross.weekdayName})`);
  console.log(`UTC 2026-08-16T06:00:00Z -> Катманду: ${labelFromParts(parts)} (перекрёстно: ${cross.weekdayName} ${String(cross.hour).padStart(2,'0')}:${String(cross.minute).padStart(2,'0')})`);
}

// Кейс 3: часовой пояс с целым смещением (Москва, UTC+3) — функция не должна
// быть завязана специально на дробные сдвиги.
{
  const date = new Date('2026-08-16T21:30:00Z');
  const parts = getZonedDateParts(date, 'Europe/Moscow');
  const cross = crossCheckParts(date, 'Europe/Moscow');

  check(parts.hour === 0 && parts.minute === 30, `Москва: ожидали 00:30 следующего дня, получили ${parts.hour}:${parts.minute}`);
  check(parts.hour === cross.hour && parts.minute === cross.minute,
    `Москва: час/минута расходятся с перекрёстной проверкой (${parts.hour}:${parts.minute} vs ${cross.hour}:${cross.minute})`);
  check(WEEKDAY_SHORT[parts.weekday] === cross.weekdayName,
    `Москва: день недели расходится с перекрёстной проверкой (${WEEKDAY_SHORT[parts.weekday]} vs ${cross.weekdayName})`);
  console.log(`UTC 2026-08-16T21:30:00Z -> Москва: ${labelFromParts(parts)} (перекрёстно: ${cross.weekdayName} ${String(cross.hour).padStart(2,'0')}:${String(cross.minute).padStart(2,'0')})`);
}

if (failures > 0) {
  console.error(`\n${failures} проверок шага 2 не прошло.`);
  process.exit(1);
} else {
  console.log('\nВсе проверки шага 2 пройдены.');
}

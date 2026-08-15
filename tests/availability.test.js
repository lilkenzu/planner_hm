'use strict';

const {
  getZonedDateParts,
  computeParticipantSlot,
  computeSlotAvailability,
  buildWeekGrid,
} = require('../availability.js');

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

console.log('\n--- Шаг 3: сетка и расчёт доступности ---');

// Кейс 4: границы рабочего часа. Синтетический участник в поясе UTC (чтобы не
// смешивать проверку границы с реальной конвертацией пояса) с часами 09:00-18:00.
// Слот 09:00-09:30 доступен (начало включительно), 17:30-18:00 доступен
// (последний перед концом), 18:00-18:30 недоступен (конец не включён).
// Заодно это и есть вырожденный случай "сетка с 1 участником": 100%/0%.
{
  const referenceDay = new Date('2026-08-17T00:00:00Z');
  const weekday = getZonedDateParts(referenceDay, 'UTC').weekday;
  const solo = { id: 'solo', timeZone: 'UTC', startTime: '09:00', endTime: '18:00', days: [weekday] };

  const earlyStart = computeSlotAvailability([solo], new Date('2026-08-17T09:00:00Z'));
  check(earlyStart.percent === 100, `Граница начала (09:00-09:30): ожидали 100%, получили ${earlyStart.percent}%`);
  check(earlyStart.details[0].available === true, 'Граница начала (09:00-09:30): участник должен быть доступен');

  const beforeStart = computeSlotAvailability([solo], new Date('2026-08-17T08:30:00Z'));
  check(beforeStart.percent === 0, `До начала (08:30-09:00): ожидали 0%, получили ${beforeStart.percent}%`);
  check(beforeStart.details[0].reason === 'before-start', `До начала: ожидали причину before-start, получили ${beforeStart.details[0].reason}`);
  check(beforeStart.details[0].diffMinutes === 30, `До начала: ожидали разницу 30 минут, получили ${beforeStart.details[0].diffMinutes}`);

  const lateEnd = computeSlotAvailability([solo], new Date('2026-08-17T17:30:00Z'));
  check(lateEnd.percent === 100, `Граница конца (17:30-18:00): ожидали 100%, получили ${lateEnd.percent}%`);

  const afterEnd = computeSlotAvailability([solo], new Date('2026-08-17T18:00:00Z'));
  check(afterEnd.percent === 0, `После конца (18:00-18:30): ожидали 0%, получили ${afterEnd.percent}%`);
  check(afterEnd.details[0].reason === 'after-end', `После конца: ожидали причину after-end, получили ${afterEnd.details[0].reason}`);
  check(afterEnd.details[0].diffMinutes === 0, `После конца: ожидали разницу 0 минут ровно на границе, получили ${afterEnd.details[0].diffMinutes}`);

  const dayOff = computeSlotAvailability([{ ...solo, days: [] }], new Date('2026-08-17T10:00:00Z'));
  check(dayOff.details[0].reason === 'day-off', `Нерабочий день: ожидали причину day-off, получили ${dayOff.details[0].reason}`);

  console.log(`Границы часа (09:00-18:00 UTC): 09:00->${earlyStart.percent}%, 08:30->${beforeStart.percent}%, 17:30->${lateEnd.percent}%, 18:00->${afterEnd.percent}%`);
}

// Кейс 5: округление процента на синтетических участниках (изолируем
// арифметику от реальной конвертации поясов — все трое в UTC).
{
  const referenceDay = new Date('2026-08-17T00:00:00Z');
  const weekday = getZonedDateParts(referenceDay, 'UTC').weekday;
  const working = { timeZone: 'UTC', startTime: '09:00', endTime: '18:00', days: [weekday] };
  const off = { timeZone: 'UTC', startTime: '09:00', endTime: '18:00', days: [] };
  const slot = new Date('2026-08-17T10:00:00Z');

  const oneOfThree = computeSlotAvailability(
    [{ ...working, id: 'p1' }, { ...off, id: 'p2' }, { ...off, id: 'p3' }],
    slot,
  );
  check(oneOfThree.percent === 33, `1 из 3 должно округляться до 33%, получили ${oneOfThree.percent}%`);
  check(Number.isInteger(oneOfThree.percent), 'Процент должен быть целым числом');

  const twoOfThree = computeSlotAvailability(
    [{ ...working, id: 'p1' }, { ...working, id: 'p2' }, { ...off, id: 'p3' }],
    slot,
  );
  check(twoOfThree.percent === 67, `2 из 3 должно округляться до 67%, получили ${twoOfThree.percent}%`);

  console.log(`Округление: 1/3 -> ${oneOfThree.percent}%, 2/3 -> ${twoOfThree.percent}%`);
}

// Кейс 6: Катманду (+5:45) и переход через полночь в составе полной сетки —
// комбинация со сдвигом дня недели. Тот же UTC-момент, что и в шаге 2
// (19:00 UTC -> Kathmandu Mon 00:45), но теперь проверяем availability,
// а не только сырые час/минуту.
{
  const bob = {
    id: 'bob',
    timeZone: 'Asia/Kathmandu',
    startTime: '09:00',
    endTime: '18:00',
    days: [0, 1, 2, 3, 4], // вс-чт, Mon(=1) входит
  };
  const slot = computeParticipantSlot(bob, new Date('2026-08-16T19:00:00Z'));
  check(slot.available === false, 'Катманду 00:45 понедельника: до начала рабочего дня, должен быть недоступен');
  check(slot.reason === 'before-start', `Катманду 00:45: ожидали before-start, получили ${slot.reason}`);
  check(slot.diffMinutes === 495, `Катманду 00:45: ожидали разницу 495 минут (9ч15м до 09:00), получили ${slot.diffMinutes}`);
  console.log(`Катманду, понедельник 00:45 (после перехода через полночь): reason=${slot.reason}, diffMinutes=${slot.diffMinutes}`);
}

// Кейс 7: полная сетка на 3 реалистичных участниках из разных поясов с
// разными неделями (Катманду Вс-Чт, Берлин и Лондон Пн-Пт) — для 3
// участников процент может быть только 0/33/67/100, и за неделю должны
// встретиться все четыре значения (иначе состав участников не проверяет
// то, что должен). Первая попытка была с Нью-Йорком и Токио — эти пояса
// оказались настолько разнесены во времени, что триплет ни разу не пересёкся
// на 100% за всю неделю (реальный, не выдуманный случай "нет совпадения"),
// поэтому подобрал состав, где полное пересечение действительно случается —
// иначе тест не проверяет то, что должен проверять.
{
  const bob = { id: 'bob', timeZone: 'Asia/Kathmandu', startTime: '09:00', endTime: '18:00', days: [0, 1, 2, 3, 4] };
  const diana = { id: 'diana', timeZone: 'Europe/Berlin', startTime: '09:00', endTime: '17:00', days: [1, 2, 3, 4, 5] };
  const liam = { id: 'liam', timeZone: 'Europe/London', startTime: '09:00', endTime: '17:00', days: [1, 2, 3, 4, 5] };

  const grid = buildWeekGrid([bob, diana, liam], new Date('2026-08-16T00:00:00Z'));
  check(grid.length === 336, `Сетка на 7 дней по 30 минут должна давать 336 слотов, получили ${grid.length}`);

  const allowedPercents = [0, 33, 67, 100];
  const onlyAllowed = grid.every((slot) => allowedPercents.includes(slot.percent));
  check(onlyAllowed, 'Для 3 участников процент должен быть только 0/33/67/100');

  const seenPercents = new Set(grid.map((slot) => slot.percent));
  check(seenPercents.has(0), 'За неделю должен встретиться слот с 0% (никто не доступен)');
  check(seenPercents.has(33), 'За неделю должен встретиться слот с 33% (доступен ровно 1 из 3)');
  check(seenPercents.has(67), 'За неделю должен встретиться слот с 67% (доступны 2 из 3)');
  check(seenPercents.has(100), 'За неделю должен встретиться слот со 100% (доступны все трое) — иначе состояние "нет совпадения" будет всегда включено');

  console.log(`Сетка Bob/Diana/Liam: ${grid.length} слотов, встреченные проценты: ${[...seenPercents].sort((a, b) => a - b).join(', ')}`);
}

if (failures > 0) {
  console.error(`\n${failures} проверок не прошло.`);
  process.exit(1);
} else {
  console.log('\nВсе проверки пройдены (шаги 2 и 3).');
}

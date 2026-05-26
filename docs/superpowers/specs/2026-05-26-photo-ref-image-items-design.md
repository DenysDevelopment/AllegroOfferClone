# Фото-референсы в IMAGE-items описания

**Дата:** 2026-05-26
**Ветка:** `feat/photo-ref-image-items`

## Проблема

Уже сделанные inline-фото-чипы живут только внутри TEXT-item. А отдельные
IMAGE-items секции (которые рисует `DescriptionEditor` как строка
«превью + URL-инпут + ✕») по-прежнему привязаны к конкретному URL — то есть
шаблон с такими картинками не годится для другого оффера. Нужно дать
IMAGE-item ту же позиционную ссылку `{{photo:N}}`, что и inline-чипу.

## Решение в одной фразе

IMAGE-item теперь может держать в `url` либо обычный URL, либо токен
`{{photo:N}}`. В редакторе такая строка рисуется как чип-плашка с превью.
При публикации `expandPhotoChips` подставляет реальный URL из фото оффера
под номером N (а если N вне диапазона — дропает item и сообщает в alert).

## Модель данных

`DescriptionItem` не меняется: `TEXT | IMAGE`. Поле `IMAGE.url` теперь
может содержать строку одной из двух форм:

| Форма | Пример | Когда |
|-------|--------|-------|
| URL | `https://cdn.allegro.pl/.../a.jpg` | обычная картинка |
| Photo-ref token | `{{photo:1}}` | ссылка на фото оффера по позиции |

Новый чистый helper в `web/src/components/shortcodes.ts`:

```ts
export function parsePhotoRefUrl(s: string): { idx: number } | null;
```

Возвращает `{ idx: N }` если строка матчит `/^\{\{photo:(\d+)\}\}$/`, иначе
`null`. Используется и в редакторе (отличить рендер строки), и в самой
секции при сериализации.

## UI

### 6.1. Кнопка «+ Фото» в шапке секции

Рядом с существующими «+ текст» и «+ картинка» в нижнем тулбаре секции —
третья кнопка **«+ Фото»**. Клик открывает ту же выпадашку с миниатюрами,
что и inline-пикер в `RichTextarea`. Клик по миниатюре N → в секцию
добавляется новый IMAGE-item с `url = '{{photo:N}}'`. Кнопка задизейблена,
если у оффера нет фото; закрытие — по клику вне (тот же паттерн).

### 6.2. Кнопка «+ Фото» на каждой существующей IMAGE-строке

Между URL-инпутом и крестиком ✕ появляется маленькая кнопка **«+ Фото»**.
Клик открывает ту же выпадашку → клик по N заменяет `url` этой строки на
`{{photo:N}}`. Так удобно «превратить» только что добавленную пустую
картинку в фото-реф, не удаляя и не добавляя заново.

### 6.3. Рендер фото-реф строки

Когда `parsePhotoRefUrl(it.url) !== null`, строка рисуется иначе:

```
[превью photoUrls[N-1]] [ Фото · N ]                      [×]
```

URL-инпут НЕ показывается. Превью — миниатюра из `photoUrls[N-1]` (или
серый плейсхолдер «—», если N вне диапазона). Бейдж использует тот же
класс `var-chip` (а `var-chip--missing` — когда вне диапазона). ✕ удаляет
item как обычно. Сменить → удалить и добавить заново.

## Раскрытие при публикации

Существующий `expandPhotoChips(description, photoUrls)` расширяется: после
обработки TEXT-items добавляется новый случай для IMAGE-items.

Алгоритм per-item:

```
if it.type === 'IMAGE':
  ref = parsePhotoRefUrl(it.url)
  if ref is null:
    emit it (обычный URL — не трогаем)
  else if ref.idx >= 1 && ref.idx <= photoUrls.length:
    emit { type: 'IMAGE', url: photoUrls[ref.idx - 1] }
  else:
    unresolved.add(`photo:${ref.idx}`)
    (item дропается — Allegro не примет токен в url)
```

Логика TEXT-items не меняется (она уже сплитит TEXT вокруг `{{photo:N}}`).

`unresolved` теперь может содержать ключи и из TEXT, и из IMAGE — оба идут
в общий список. `handleApplyTemplate` в `App.tsx` / `NewProductPanel.tsx`
уже выводит unresolved в alert — без изменений.

## Сервер: схема шаблонов

Сейчас `templateCreateSchema` / `templateUpdateSchema` в
`server/src/routes/api.ts` используют общий `descriptionSchema`, где
`IMAGE.url: z.string().url()` — это **отвергнет** шаблоны, содержащие
фото-реф в IMAGE-item.

Добавляется отдельная пара схем рядом с существующей:

```ts
const templateDescriptionItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), content: z.string() }),
  z.object({
    type: z.literal('IMAGE'),
    url: z.union([
      z.string().url(),
      z.string().regex(/^\{\{photo:\d+\}\}$/),
    ]),
  }),
]);
const templateDescriptionSections = z
  .array(z.object({ items: z.array(templateDescriptionItemSchema).min(1) }))
  .min(1);
```

В `templateCreateSchema` и `templateUpdateSchema` подменяется
`sections: descriptionSchema.shape.sections` →
`sections: templateDescriptionSections`. Никаких других схем не трогаем.

`descriptionSchema` (используется в `cloneSchema` / `proposeProductSchema`)
остаётся строгой: публикация уже прогоняется через `expandPhotoChips`,
токенов в payload не будет.

## Поведение шаблонов

- **Сохранение:** в `description.sections` могут быть IMAGE-items с
  `url='{{photo:N}}'` — сохраняются как есть (схема шаблона их принимает).
- **Применение к другому офферу:** токен переживает применение, при
  следующем рендере IMAGE-строка покажет превью нового фото оффера.
- **Применение к офферу с меньшим числом фото:** out-of-range → ключи
  попадают в `unresolved`, alert уже это показывает (раньше — только
  переменные и inline-фото-токены, теперь и IMAGE-фото-рефы тоже).
- **Публикация:** `expandPhotoChips` дропает out-of-range IMAGE-items,
  обычные URL переживают, фото-рефы превращаются в IMAGE с URL.

## Тесты

- `parsePhotoRefUrl` — match/no-match, граничные случаи (`{{photo:0}}`,
  пустая строка, обычный URL, `{{ photo:1 }}` (пробелы — должен НЕ
  матчить, проверка точная по `^…$`)).
- `expandPhotoChips` — новые кейсы для IMAGE:
  - resolved photo-ref IMAGE → IMAGE с реальным URL.
  - out-of-range photo-ref IMAGE → дроп + ключ в unresolved.
  - обычный URL IMAGE → unchanged.
  - смешанный кейс: TEXT с inline-чипом + IMAGE-фото-реф в одной секции.
- UI (пикер, рендер фото-реф строки) — ручная проверка в браузере.

## Вне scope (YAGNI)

- Конвертация фото-реф → URL обратно на той же строке.
- Drag-n-drop порядка items внутри секции.
- Множественный выбор в пикере.
- Сохранение URL-фолбэка на случай если шаблон применили к офферу без фото.

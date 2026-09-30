# Фаза 1 — скелет на приложението

Дата: 28 септември 2026 г.

Версия: 1.0. Планът е условно одобрен от Claude Opus 4.8 на 28 септември 2026 г.; резултатите от започнатата реализация са записани в §13.

Основа: [архитектурен план v2.2](ARCHITECTURE.md). Настоящият документ определя първата изпълнима задача, а не заменя общата архитектура. Резултатът от първото Opus ревю е в §12.

## 1. Очакван резултат

Разработчик може да изтегли репото, да изпълни `npm ci`, да стартира общия Next/Express сървър и да отвори минимални BG/EN страници. Същото приложение може да се изгради и стартира в production режим с един публичен порт и един Node процес, подходящо за една Render Web Service.

Фронтендът и бекендът имат ясни отговорности. CI проверява типовете, lint, тестове, покритие и production smoke сценарии. Фазата е завършена само при измерено минимум 80% покритие за всеки от четирите показателя, отделно за ФЕ и БЕ.

Необходим е отделен дизайн документ, защото общият план обхваща целия продукт, а тази задача трябва да има ограничен обхват и проверими критерии за приемане. Няма съществуващ приложен код за разширяване: към началото има документация, `.gitignore` и дизайн ресурси.

## 2. Обхват и отложени части

В тази фаза включваме:

- Next.js App Router, React, Express и TypeScript; един `package.json` и lockfile.
- Общ custom server за dev и production, отделна TS compilation за БЕ.
- Минимални начална и примерна About страница на двата езика, истински SSR HTML и language switcher.
- Suffix routing, canonical redirects, валиден `html lang`, базови metadata и 404.
- Express health/readiness endpoint и JSON 404 за неизвестно API; без демонстрационен бизнес CRUD.
- Минимален глобален CSS: reset, типография със системен шрифт, контейнер, spacing, link/button/focus. Стойностите са технически временни.
- Проверка на Next resources и image optimization с малко локално растерно изображение; SVG логото не се конвертира за тази цел.
- Unit/integration тестове, browser smoke, отделни coverage gates и CI.
- Кратък коренов README за инсталиране, команди, текущия обхват и връзки към `doc/`.

Не включваме MongoDB/Mongoose, модели, login/admin, сесии/CSRF, контактна форма, email/CAPTCHA, storage/uploads, CMS, финални публични страници, GSAP/Three.js, видео, analytics или миграция. Не инсталираме пакетите за тези функции предварително. Не създаваме Render услуга и не променяме production, DNS, secrets или стария сайт.

Границата е изрична: архитектурният план изисква MongoDB готовност и проверка на общи admin сесии за завършеното приложение. Skeleton още няма тези зависимости, така че неговият `/healthz` удостоверява само готовността на Express/Next. DB startup, динамични DB reads, admin root layout и auth/CSRF се доказват в следващата фаза, преди CMS работа. Преминал skeleton не означава, че целият архитектурен spike е завършен.

## 3. Зависимости и версии

| Група | Пакети/инструменти | Предназначение |
| --- | --- | --- |
| Runtime | `next`, `react`, `react-dom`, `express` | Страници и общ HTTP вход |
| Runtime при нужда | `sharp` | Self-hosted Next image optimization; проверка спрямо избраната Next версия |
| Development | `typescript`, подходящите `@types/*`, `tsx`, `cross-env` | Типове, dev стартиране и преносими npm scripts |
| Lint | ESLint и съвместимата Next конфигурация | Проверки за ФЕ и БЕ |
| Unit/integration | Vitest, съвпадаща версия на V8 coverage provider, Testing Library, jsdom, Supertest | UI, чисти функции, Express HTTP поведение |
| Browser | Playwright | Проверка на реалния production сървър и App Router |

Не записваме непроверени patch версии в този предварителен документ. При реализацията първата стъпка е проверка на поддържани stable версии, engines/peer dependencies и advisories от официалните източници/registry. Изборът се записва в package manifest, lockfile и README. Не се използва canary или неподдържан runtime и не се изпълнява сляпо `npm audit fix --force`.

Локално са установени Node 22.14.0 и npm 10.9.2; това е наблюдение, не окончателен избор. Dev, CI и бъдещият Render runtime трябва да използват една съвместима поддържана Node линия и договорена версия на npm. Глобалните инсталации на потребителя не се сменят като страничен ефект.

## 4. Минимална структура и ownership

```text
doc/
  ARCHITECTURE.md
  01-application-skeleton.md
app/
  (site)/[lang]/layout.tsx
  (site)/[lang]/page.tsx
  (site)/[lang]/about/page.tsx
  ... минималните error/not-found файлове според доказания routing вариант
components/           споделено съдържание на страниците и езикови връзки
lib/                  locale validation, messages access и общ URL builder
messages/             bg.json, en.json с минимални технически текстове
styles/globals.css
server/
  index.ts            entry point и lifecycle
  app.ts              съставяне на Express middleware/маршрути, без listen при import
public/               собствено лого и малък локален image fixture
tests/
  frontend/
  backend/
  e2e/
.github/workflows/    една CI проверка
package.json
package-lock.json
tsconfig.json
tsconfig.server.json
next.config.*
eslint.config.*
vitest.*              отделни ФЕ/БЕ конфигурации с независими coverage gates
playwright.config.*
README.md
```

Това е минимална цел, не задължение за празни директории. Не създаваме празни managers/controllers/models, auth mock или demo resource само за да запълним архитектурната схема. При първия реален ресурс добавяме модулен router controller и manager според общия план.

`server/app.ts` е необходима локална граница, за да се тества реалният Express pipeline без автоматично отваряне на порт при import. `server/index.ts` държи prepare/listen/shutdown и се покрива с lifecycle тестове. Не добавяме service container или обща plugin система.

Next пази нормалната си TS конфигурация; БЕ има отделен `tsconfig.server.json`. Предпочитан server build: NodeNext/ESM с imports, които работят в компилирания Node output. Само server код влиза в `dist/server`; Next не компилира повторно този output. При избора на ESM се съобразяват конфигурационните файлове и package `type`. Runtime paths не зависят от TS aliases, които Node не разбира.

Всички бъдещи design/review документи са в `doc/`. `AGENTS.md` остава в корена като инструкции за работа; README остава входната точка за разработчика. Не дублираме архитектурата в два файла.

## 5. Dev, build и production lifecycle

Планирани команди; окончателната реализация се проверява и на Windows:

| Команда | Договор |
| --- | --- |
| `npm ci` | Възпроизводима инсталация от lockfile |
| `npm run dev` | `tsx` watch за custom server с изричен development режим |
| `npm run build` | Next build и отделна TS компилация на БЕ; грешка в който и да е етап спира командата |
| `npm start` | Production режим и компилираният custom server, не `next start` |
| `npm run typecheck` | Проверява и двете TS конфигурации без emit |
| `npm run lint` | ESLint CLI за приложния код и конфигурациите |
| `npm test` | Всички unit/integration тестове без watch |
| `npm run test:coverage` | Двата независими ФЕ/БЕ coverage runs; ненулев exit при който и да е провал |
| `npm run test:e2e` | Browser smoke срещу production build с автоматичен start/stop |

`cross-env` или еквивалентен преносим механизъм задава режимите; няма Unix-only env assignment в npm scripts. Dev watcher не следи `.next`, `dist`, coverage/reports и не влиза в restart loop с Next HMR. Проверяваме промяна на страница и промяна на Express кода поотделно.

Последователност на production старта:

1. Валидиране на несекретната runtime конфигурация. `PORT` има локален default 3000; при задаване се приема само валидно цяло число от 1 до 65535. Host е `0.0.0.0`.
2. Програмно създаване на Next в production режим и `prepare()`.
3. Създаване на Express и HTTP server; Next получава всички не-API заявки чрез своя request handler.
4. Отваряне на порта и готовност. Преди prepare/listen няма успешен health отговор.
5. SIGTERM/SIGINT задействат идемпотентно спиране: отказ на readiness, спиране на нови връзки, приключване на активните в ограничен срок, затваряне на Next/HTTP ресурсите; след срока принудително прекратяване. Startup failure завършва с ненулев код и безопасен лог.

Не използваме `output: standalone`. Локалният production тест се изпълнява от чист build без dev сървър. Тест за occupied port и провалено Next prepare доказва, че процесът не остава да изглежда работещ. CI на Linux проверява SIGTERM; Windows проверява нормалното dev start/stop според платформата.

## 6. HTTP договор и маршрутизация

| Заявка | Очакван резултат |
| --- | --- |
| `GET /healthz` | 200 и минимален JSON `{ "status": "ok" }`, `Cache-Control: no-store` след готовност |
| Неизвестен `/api` или `/api/...` | JSON 404, без попадане в Next HTML |
| `/` | Временен 307 redirect към `/bg` за skeleton; default bg още е продуктово предложение |
| `/bg`, `/en` | 200, минимална начална страница и правилен `html lang` |
| `/about/bg`, `/about/en` | 200, минимална втора страница със suffix език |
| `/bg/about`, `/en/about` | Един 308 redirect към публичния suffix адрес |
| Непозната страница/език | Истински HTTP 404, без fallback към българска 200 страница |
| `/_next/...`, локален image asset | Обслужване от Next с правилния content type |

API middleware не обработва body на Next заявките. `/healthz` е инфраструктурен endpoint, не нов бизнес resource. Не добавяме parser за несъществуващи бизнес POST маршрути. Error response не излага stack traces, вътрешни пътища или env стойности.

При Express 5 не използваме старите необозначени wildcard patterns като `app.all('*')`. Крайният Next handler може да се монтира чрез middleware без wildcard path; API 404 остава преди него. Това се доказва с реален старт, не само с mock на router.

### Езиковият spike

Основен вариант: ограничени Next config rewrites/redirects от обща route карта, както е описано в архитектурата. Те покриват само началната и About страницата. `app/(site)/[lang]/layout.tsx` е единственият site root с `<html>/<body>`; няма вложен общ root. Няма admin страници на този етап.

Преди запазването на този вариант се сравнява директен suffix route вариант като контролна проба. Не оставяме две паралелни routing имплементации в крайния код. Ако rewrites не покрият всички проверки, крайният skeleton използва директни suffix route файлове с общи компоненти, а конкретната root layout структура се документира и проверява за `html lang`. Не въвеждаме catch-all page router, който замества App Router.

Locale се валидира преди зареждане на речник. Async `params` се използват според избраната Next версия. Един URL builder съставя всички вътрешни линкове и езиковите alternates; не разчитаме на pathname от rewrite за canonical адреса. Езиковото превключване запазва типа страница. Няма language cookies/localStorage в skeleton.

Metadata използва валидиран `SITE_URL`, локално по подразбиране localhost с избрания порт. Не се доверява на произволен request Host. Skeleton има noindex за предотвратяване на случайно индексиране; canonical и BG/EN alternates все пак се проверяват. Sitemap за окончателните страници се добавя с информационната архитектура, не с фиктивни бизнес URL-и сега.

Не скриваме невалидните locale/route грешки зад streamed 200. HTTP статусът се проверява с реална заявка; ако избраният layout/fallback стрийминг води до 200 за непознат маршрут, това е дефект, който трябва да се отстрани преди приемане. Проверява се и напълно несъответстващ top-level URL извън locale route групата: 404 документът има валидни `<html>/<body>` и подходящ `lang` (bg за URL без разпознаваем език). Окончателната root/not-found структура се записва след spike; не считаме, че nested not-found автоматично покрива всички несъответстващи URL-и.

## 7. Минимален интерфейс

Две семантични страници с кратки BG/EN технически текстове, навигация между тях и езикови линкове. Те демонстрират SSR, client navigation и преводите; не утвърждават бъдещата навигация, услуги или визуална идентичност.

Съдържанието се вижда без JavaScript. Общият CSS определя четим системен шрифт, responsive контейнер, основни размери, контраст, focus и skip link. Без отделни повтарящи се button стилове и без празни CSS Modules. Няма hero/3D, външни fonts или големи изображения от мокъпите.

Изображението за техническата проверка е малък собствен локален raster fixture с изрични dimensions и `sizes`. То проверява `next/image`, а не дизайна. SVG логото остава в оригиналния формат.

## 8. Тестове и минимум 80% покритие

Минимум **80% за lines, statements, functions и branches**, поотделно за ФЕ и БЕ. Не осредняваме двата слоя. Праговете се налагат от първия implementation PR, не се отлагат за края на сайта.

Vitest има две отделни конфигурации/runs с отделни output директории. ФЕ включва `app/**/*.{ts,tsx}`, `components/**/*.{ts,tsx}`, `lib/**/*.{ts,tsx}` и всеки допълнителен собствен frontend source path. БЕ включва `server/**/*.ts`, включително bootstrap/lifecycle. Общият routing builder принадлежи на ФЕ coverage дори когато се използва и от Next config. Непосетените от тестове файлове остават в знаменателя чрез изрично `coverage.include`.

Изключват се само генерирани файлове, зависимости, декларации само за типове, тестове и техните fixtures/helpers, статични медии и конфигурация без приложна логика. Изпълнима routing/валидационна логика не става изключение само защото е поставена в config файл. Не добавяме ignore коментари за достигане на прага.

### Async Server Components

Vitest не доказва App Router/RSC поведението на async Server Components. Чистите функции, синхронните изгледи и малките async orchestration функции могат да се тестват отделно, но това не замества browser проверката. Async pages/layouts не се изключват от coverage. Там, където е безопасно, те се извикват като async функции с явни входове и контролирани framework adapters за source coverage; production Playwright тестовете доказват действителния Next runtime.

Ако това не позволява честно измерване и достигане на прага за целия включен код, преди приемане добавяме действително инструментирано server/browser покритие с правилни source maps и дедупликация към един и същ source file. Не броим минали E2E сценарии като покрити редове без реални coverage данни. Не променяме начина на рендиране или public/private границите само за тестовия процент. Необоснован coverage резултат е блокер за приемане.

### Проверки по слоеве

| Слой | Проверявано поведение |
| --- | --- |
| ФЕ unit | Валиден/невалиден locale; URL builder, BG/EN alternates, правилен текст и достъпни връзки |
| БЕ integration | `/healthz`, API 404 и content type; forwarding към Next без консумиране на body; безопасни грешки |
| БЕ lifecycle | PORT parsing, prepare failure, occupied port, listen readiness, идемпотентно shutdown и deadline |
| Production browser/HTTP | SSR без JS, reload, Link navigation, prefetch/RSC, back/forward, езиково превключване, `html lang`, canonical/hreflang |
| Production ресурси | Next JS/CSS assets и реална image optimization заявка |
| Отрицателни случаи | Невалиден locale/маршрут → HTTP 404; API → JSON 404; redirect без loop; без hydration errors |
| Достъпност | Основна keyboard навигация, видим focus, skip link, mobile reflow |

Подменяме външните граници в unit тестовете, не очакваното поведение. Реалният Express pipeline се тества със Supertest. Playwright стартира компилираното приложение и не използва dev сървър или неочакван вече работещ процес. Browser coverage, ако се добави, не включва Next/React internals в знаменателя.

## 9. CI и възпроизводимост

Един workflow за PR/push изпълнява: checkout → договорения Node/npm → `npm ci` → typecheck → lint → двата coverage runs → production build → Playwright browser dependencies → production smoke. Backend/frontend coverage отчети се пазят като отделни CI artifacts; при провал Playwright trace/report се пази без секрети.

Playwright стартира сървъра само за теста, чака ограничено време за `/healthz` и затваря процеса след успех или грешка. Портът е известен на тестовете и `SITE_URL`; зает порт води до провал вместо свързване към друго приложение. Coverage/build/test output остава извън Git. Не четем env файлове; фазата трябва да работи без secrets, DB или мрежови услуги след инсталирането на зависимости.

Предаваме само необходимите конфигурационни имена в README: `PORT`, `NODE_ENV`, `SITE_URL`. Не създаваме реални secret-bearing env файлове. Проверяваме `npm ci` от lockfile и на Linux CI, и локалния Windows dev workflow. Бъдещите Render build/start команди са документирани, но remote deploy не се изпълнява в тази задача.

## 10. Критерии за приемане

Фаза 1 е готова само когато:

1. От чист checkout инсталацията и всички договорени команди работят; няма зависимости от live системи.
2. Един production процес обслужва Next страниците, assets и Express endpoints на един порт.
3. Dev HMR и server restart работят без цикли; production няма dev-only startup зависимости.
4. Всички маршрути от §6 покриват HTTP и browser сценариите, включително истински 404 и липса на redirect loop.
5. SSR HTML съдържа текста, линковете и правилния език; няма hydration грешки и компонентна дублирана бизнес логика.
6. Всеки от четирите coverage показателя е ≥80% отделно за ФЕ и БЕ и CI прилага праговете върху целия договорен source scope.
7. `typecheck`, lint, тестове, production build и E2E са успешни; локалните резултати са разграничени от действителен CI run.
8. README съдържа точните версии, команди, runtime настройки, избрания routing вариант и известните ограничения.
9. При финалното ревю е представен действителният diff на имплементацията на Opus и валидните забележки са отстранени.
10. Не са добавени функционалности извън фазата и няма промени по live услуги/данни.

Coverage, production smoke и routing решенията се отчитат с резултати след реализацията. Този дизайн документ сам по себе си не е доказателство за преминали тестове.

## 11. Ред на работа след одобрение

1. Проверка/фиксиране на версии и минимален package/TS setup, със запазване на съществуващите файлове.
2. Custom server, dev/build/start и lifecycle; първи backend тестове.
3. Locale/root layout и route spike; избор на една крайна имплементация.
4. Минимални страници, глобален CSS, metadata, image fixture и frontend тестове.
5. Двата coverage gates, production browser сценарии и CI; поправки до изпълнение на критериите.
6. Обновяване на документа с установените решения/резултати, Opus diff review и предаване на потребителя.

При несъвместимост, която налага промяна на твърдо изискване, спираме зависимата имплементация и обсъждаме конкретния проблем. Не преминаваме към две платени Render услуги, префиксни публични URL-и или по-ниско coverage.

## 12. Източници и техническо ревю

Официални източници, проверени при подготовката:

- https://nextjs.org/docs/app/guides/custom-server
- https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites
- https://nextjs.org/docs/app/guides/testing/vitest
- https://vitest.dev/guide/coverage.html
- https://expressjs.com/en/guide/migrating-5/

Opus трябва да оцени реалистичността на обхвата, lifecycle/build, locale layout и suffix routing, истинските HTTP 404, независимите coverage gates и ограниченията на async Server Component тестовете. Да разграничи отложените продуктови функции от липсваща основа на skeleton.

### Резултат от Claude Opus 4.8 — 28 септември 2026 г.

Документът е изпратен в пълен вид с архитектурния план като reference чрез Claude CLI с `--model claude-opus-4-8` и UTF-8 подаване. Reviewer потвърди, че кирилицата е напълно четима. Ревюто е само върху предоставените документи, без имплементация или изпълнение на тестове.

Вердикт: **УСЛОВНО ОДОБРЕН**, без материални архитектурни блокери. Opus потвърди съответствието с една Render услуга, Express/Next разделението, suffix URL-и, глобален CSS и независими ≥80% coverage gates. Ограниченият обхват без DB/auth е приет за първата фаза.

Две изрични условия за приемане на реализацията:

1. Production spike доказва окончателната root/not-found структура, истински top-level HTTP 404 и валиден `html lang`, включително адреси извън locale route групата. Това е изрично уточнено в §6.
2. Coverage отчетите доказват ≥80% по всеки от четирите показателя отделно за ФЕ/БЕ, включително непосетени файлове и async Server Components. Unit извикването не се представя като доказателство за RSC runtime, а E2E се брои към coverage само при реална instrumentation.

Другите проверки от ревюто — client navigation/RSC/prefetch при rewrites, действителен image optimization request и разделени Linux/Windows lifecycle сценарии — вече са включени в критериите на този документ. Opus ги разглежда като проверки при реализация, а не като липсваща архитектура.

Към момента на това първо ревю не са изпълнявани application build, coverage или browser тестове. Одобрението е за дизайна и не се пренася автоматично върху бъдещите DB/auth/design фази.

## 13. Реализация и локална проверка — 28 септември 2026 г.

Избран е директният suffix routing вариант: `/bg`, `/en`, `/about/bg`, `/about/en` са реални App Router файлове с общи `SitePage`, `SiteDocument`, URL builder и речници. Отделните BG/EN root layout-и задават `html lang`; `global-not-found.tsx` връща цял BG документ за непознатите top-level адреси. Този вариант преминава production HTTP и browser проверките без rewrite слой.

Локално са успешни `npm run typecheck`, `npm run lint`, `npm test` (9 frontend и 13 backend теста), `npm run test:coverage`, `npm run build` и `npm run test:e2e` (5 Chromium сценария срещу production сървъра). След финалните поправки отчетеното frontend покритие е 100% за четирите показателя; backend: 100% lines, 92.85% statements, 95.23% functions и 85.29% branches. Vitest включва и непосетените source файлове; browser тестовете доказват Next runtime поведението, без да се прибавят фиктивно към coverage. Production browser проверките обхващат SSR без JavaScript, езикови адреси и metadata, client navigation, redirects, истински HTML/JSON 404, image optimization, RSC, keyboard access и mobile reflow.

Допълнително `npm ci --offline` преинсталира успешно зависимостите от lockfile. `npm run dev` обслужи `/healthz` и `/bg`, промяна във времето на `app/(bg)/bg/page.tsx` беше последвана от успешен нов HTTP отговор, а промяна във времето на `server/app.ts` задейства `tsx` restart и нова готовност на сървъра. След спиране порт 3000 беше освободен. Първоначалният browser тест за историята разкри състезание между ранната промяна на URL и рендирането; след изчакване за съдържанието той премина 10 последователни повторения, както и целият пакет от 5 сценария. Това са локални Windows резултати, не изпълнен Linux CI run.

Claude Opus 4.8 прегледа действителния diff на source/config/test файловете. След ревюто `isLocale` използва общия списък с езици, собствеността на `/api` е изрична, логът при port conflict показва само безопасен код, а временната `noindex` настройка и изискването за production `SITE_URL` са ясно отбелязани. Останалите препоръки са за бъдеща production конфигурация или за допълнителни тестови случаи, без установен блокиращ дефект в тази фаза. README описва командите и ограниченията. След тази проверка променяемите host/port/path стойности са събрани в `lib/config.ts` и се използват от Next, Express и Playwright; компилираният сървър включва споделения файл. `npm run test:e2e:install` и browser тестовете използват стандартния Playwright cache. Инсталирането и пълният browser пакет минаха след промяната.

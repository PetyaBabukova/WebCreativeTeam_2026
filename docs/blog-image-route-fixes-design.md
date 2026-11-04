# Надеждно доставяне на изображенията в блога

Статус: подходът е одобрен от собственичката (2026-11-02); прегледан от Claude Opus (дизайн и diff), решенията са отразени по-долу; кодът е реализиран.

Решения от прегледа на diff-а: числов `code` се приема за HTTP статус само при грешки от Google API (с ключ `errors` или `response`), иначе се логва като `numericCode`, за да не се бъркат MongoDB кодове със статуси; `ENOENT` (липсващ файл на `GOOGLE_APPLICATION_CREDENTIALS`) се отчита като `no_credentials`; `idle` изтичането логва `waitingOn: client | storage`.

## Изисквания

- Всеки посетител, на всяко устройство, вижда публикуваните статии с текстовете и изображенията.
- Публикуване, редакция и изтриване — само с администраторска сесия. Гостите само четат.
- Изображенията остават в частния Google Cloud Storage bucket, данните — в MongoDB Atlas.
- Без допълнителни платени услуги. Сигурността е с предимство.

## Диагноза

Логът `Blog image lookup failed { name: 'Error' }` и 503 за изображенията се дължат на изтекли локални Application Default Credentials. Повторено извикване на `getMetadata()` със средата на приложението връща `GaxiosError` със статус 400 и тяло `{"error":"invalid_grant","error_subtype":"invalid_rapt"}`: Google Workspace изисква периодично повторно влизане и потребителският refresh token вече не е валиден. Качването пропада по същата причина.

Архитектурата (частен bucket, сървърът чете и отдава изображенията) е правилна и остава. Проблемът е нестабилна идентичност и липса на видимост. Отхвърлени: публичен bucket (блокиран от организационното правило Domain Restricted Sharing; отваря и разходи за трафик от трети страни) и Cloud CDN (платен).

## Решение — код

Без нови файлове, маршрути и зависимости. Промени в `server/blog/service.ts`, `server/blog/routes.ts`, `server/index.ts`, `lib/config.ts`.

1. **Безопасна диагностика.** `storageErrorInfo(error)` в `service.ts` връща само:
   - `name`;
   - `status` — HTTP статус 100–599 от `status`, `response.status` или числов `code` (gaxios 7 държи HTTP статуса в `status`, а `code` — само от причината);
   - `code` — низ по `^[A-Z0-9_]{1,40}$` (напр. `ECONNRESET`);
   - `reason` — първото налично от `response.data.error` (низ, OAuth), `response.data.error.errors[0].reason` (GCS JSON), `errors[0].reason` (`ApiError`), прието само по `^[A-Za-z_]{1,40}$`; при `Error`, чието съобщение започва с `Could not load the default credentials` (google-auth-library, без код) — фиксирано `no_credentials`.

   Всяко поле се проверява по тип. В лога никога не влизат `message`, `config`, headers, URL, bucket или ключ на обект. Ползва се в `Blog image lookup failed`, `Blog image read failed`, `Blog image cleanup failed`, `Blog request failed` (`safe`, покрива и качването) и в проверката на хранилището.
2. **Видими откази на достъп.** `storageAccessFailure(info)` е истина при статус 401/403 или `reason` ∈ `invalid_grant`, `invalid_client`, `unauthorized_client`, `invalid_target`, `no_credentials`. Тогава логът е `console.error("Blog storage access failed", { context, ...info })` вместо `warn`. HTTP отговорът към клиента не се променя.
3. **Ограничени повторения в SDK.** `new Storage({ retryOptions: { totalTimeout: appConfig.blog.storageRetryTotalTimeoutSeconds } })` (15 s вместо 600 s), за да не продължават повторенията към GCS дълго след като заявката на посетителя е приключила.
4. **Проверка на хранилището.** `startBlogStorageMonitor()` в `service.ts`, стартиран и спиран в `server/index.ts` като съществуващите worker-и (вкл. в `catch` при неуспешен старт):
   - невалидно `BLOG_GCS_BUCKET` → изключение и неуспешен старт (fail-fast); липсващо в реална среда (има `AUTH_MONGODB_URI`) → `console.error("Blog storage is not configured")`;
   - при старт и на всеки `storageCheckMilliseconds` (5 мин.): `getFiles({ prefix: "blog/", maxResults: 1, autoPaginate: false })` и `getMetadata()` на върнатото изображение, ако има такова, със собствен срок `storageCheckTimeoutMilliseconds` (30 s); успех доказва идентичност, съществуващ bucket, `list` и същото `get`, което ползва маршрутът (липсващ bucket дава грешка, не фалшиво „ready“; при празен bucket `get` не се доказва);
   - флаг `running` срещу застъпване: изтеклият срок се отчита веднага, но нова проверка започва едва след като висящата приключи; резултат след `stop` се игнорира;
   - логва `console.info("Blog storage ready")`, `console.error("Blog storage access failed" | "Blog storage check failed", info)` само при смяна на състоянието.

   Ограничение: проверката не доказва право за запис/изтриване; такива откази се виждат при качване като `Blog storage access failed`. `/healthz` **не** зависи от хранилището: Render рестартира услуга с неуспешен health check, а това би свалило и текстовете заради отказ само на изображенията.
5. **Таймери в `serveImage`.** Сега един 20-секунден таймер реже бавни изтегляния до 8 MB, а при изтичане преди първия байт GCS stream-ът не се унищожава (условието при `close` проверява `writableFinished`, което е истина след `end()` на 503), докато слотът вече е освободен. Нови правила:
   - *Първи байт:* `imageDeadlineMilliseconds` от началото на заявката до първия chunk.
   - *Бездействие:* след първия chunk таймер със същата стойност, рестартиран при всеки chunk и при `drain` на отговора.
   - *Абсолютен таван:* `imageTransferMaxMilliseconds` (5 мин.) от началото на заявката.
   - При изтичане GCS stream-ът винаги се унищожава; преди изпратени headers клиентът получава 503 с `no-store`, след тях връзката се прекъсва. `console.warn("Blog image timed out", { phase })`, `phase` ∈ `first_byte | idle | transfer`.
   - `release` спира всички таймери, освобождава слота точно веднъж и унищожава неприключил stream. Късен отговор на `getMetadata` след изтичане не създава stream.
6. **Кеширане.** Имената съдържат hash на съдържанието и не се променят, затова отговорът става `private, max-age=31536000, immutable` (константа `appConfig.blog.imageCacheControl`, ползвана и за метаданните при качване). `private` забранява споделени кешове (проксита/CDN), така че изтрито изображение не остава при трети страни; остава само в браузъри, които вече са го заредили. Грешките (404/429/503) остават `no-store`.

Не се променя: query string в адреса на изображение остава 404 (нарочно, защитава кеша и GCS); авторизацията за запис (сесия + CSRF + Origin) вече е правилна и покрита от теста „rejects blog writes and admin reads…“.

## Решение — конфигурация (собственичката, с помощ)

**Предварително условие:** да се премахне `NODE_TLS_REJECT_UNAUTHORIZED=0` от променливите на Windows **преди** ново влизане, иначе токените се обменят с Google без проверка на TLS.

**Локално — изборът е на собственичката:**
- *Ограничен service account + JSON ключ извън репото* (`GOOGLE_APPLICATION_CREDENTIALS` в средата на Windows) — само `Storage Object User` върху този bucket; не изтича; при изтичане на ключа щетата е ограничена до bucket-а. Може да изисква изключение от `iam.disableServiceAccountKeyCreation` само за този проект. Препоръчано.
- *По-дълъг интервал в Google Cloud session control* — без ключове, но изображенията локално спират при всяко изтичане до ново `gcloud auth application-default login`. „Never“ не се препоръчва: оставя безсрочен токен с пълните права на акаунта.

**Състояние (2026-11-03):** избран е ограниченият service account. `blog-images@webcreativeteamr-1724666509946.iam.gserviceaccount.com` има само `Storage Object User` върху bucket-а; ключът е извън репото (`E:\web_projects\WCT_2026\_keys\`), а `GOOGLE_APPLICATION_CREDENTIALS` е в `.env.local`. `iam.disableServiceAccountKeyCreation` беше изключено временно само за проекта и после върнато на „Inherit parent's policy“; за ключа за Render процедурата се повтаря.

**Продукция на Render — преди деплой.** Кодът ползва стандартните Application Default Credentials:
- *Managed OIDC + Workload Identity Federation* — без постоянни ключове, най-сигурно; по документацията на Render изисква платен Pro план.
- *Същият ограничен service account с отделен ключ като Render Secret File* — безплатно; `GOOGLE_APPLICATION_CREDENTIALS` сочи към файла в `/etc/secrets/`; ротация по график.

**Приет риск:** известията са редове в лога на Render без автоматичен alert. Мониторът логва само при промяна, така че редът е лесен за търсене; автоматично известие се добавя отделно, ако има безплатен механизъм.

## Тестове

Таймерите — с реални кратки стойности чрез временна промяна на `appConfig.blog`. Слотът — с `imageConcurrentIpLimit = 1`: следващата заявка не получава 429. Мониторът — със spy върху `Storage.prototype.bucket`.

1. `invalid_grant` (реална форма: `status: 400`, `response.data.error`) → 503 `no-store` и `Blog storage access failed`; 403 с GCS JSON и грешка от stream-а → също.
2. Форми на `reason`, `no_credentials`, низов `code` `ECONNRESET`; безопасност — `JSON.stringify` на лога не съдържа `authorization`, токен от `message` или невалиден `reason`.
3. Таймери: напредващ поток над срока завършва; спиране след първия chunk → `idle`; без първи байт → 503 и `destroy()`; над тавана → `transfer`; спрял клиент (backpressure) → `idle`; късен `getMetadata` не създава stream; слотът се освобождава.
4. Кеш: GET и HEAD с `private, max-age=31536000, immutable`; грешките — `no-store`.
5. Монитор: успех → „ready“ веднъж; `invalid_grant` → error; повторен еднакъв резултат не логва; възстановяване → „ready“; застъпване; таймаут; резултат след `stop`; липсващ/невалиден bucket.

## Извън обхвата

- Двойното `getArticle` в `generateMetadata`/`Page` и хвърлящ `cleanHtml` при четене — отделен анализ.
- `docs/blog-image-availability-design.md` (CDN) — не се прилага.

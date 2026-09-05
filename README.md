# AI Content Audit

Внутрішній інструмент Netpeak для автоматизованого AI-аудиту веб-сторінок
(блогові статті та картки товарів) на відповідність стандартам **E-E-A-T**,
**SEO** і **LLM Optimization (GEO)**.

На вхід приймає URL (один або список), скрапить сторінку (з опціональним JS-
рендерингом через headless Chromium), пропускає контент через LLM (OpenAI /
Claude / Gemini) і повертає структурований аналіз + брендований PDF-звіт у
трьох варіантах:

| Варіант | Призначення | Що містить |
|---|---|---|
| **Full** | Внутрішній продакшн-звіт | Скори, summary, сильні / критичні сторони, повний action plan з fix steps |
| **Brief** | Комерційна пропозиція | Скори, summary, сильні / критичні сторони, скорочені напрямки покращення |
| **Marketing** | Зовнішнє використання | Скори, огляд, сильні сторони, тематичне покриття |

Стиль PDF — фірмовий Netpeak (банер, типографіка, кольори).

---

## Як це працює

```
   ┌──────────────┐    1. URL(s)              ┌─────────────────┐
   │   Frontend   │ ─────────────────────────▶│   /api/scrape   │
   │  React + Vite│                            │   Puppeteer +   │
   │              │                            │   stealth plug. │
   └──────┬───────┘                            └────────┬────────┘
          │                                             │ 2. HTML
          │ 4. JSON                                     ▼
          │   analysis              ┌──────────────────────────────┐
          │                         │   /api/{openai|claude|       │
          └────────────────────────▶│            gemini}/analyze   │
                                    │   verifies + routes prompt   │
                                    └──────────────┬───────────────┘
                                                   │ 3. LLM call
                                                   ▼
                                            (OpenAI / Anthropic / Gemini)
```

1. Юзер логіниться через Google (домен `netpeak.net` / `netpeak.group`
   перевіряється серверсайд).
2. Вводить URL(и), вибирає тип сторінки (стаття / товар), мову, провайдера,
   формат PDF.
3. Бекенд скрапить сторінку (axios для статичного HTML; puppeteer-extra-stealth
   для JS-сторінок з антибот-захистом).
4. Контент із підготовленим промптом летить у LLM. Для картки товару промпт
   містить додатковий чек-лист (опис, бренд-блок, характеристики, FAQ, медіа,
   schema.org, конверсія).
5. Відповідь LLM (структурований JSON) рендериться в UI і конвертується у
   PDF за вибраним форматом.

---

## Стек

- **Backend**: Node 20 · Express 5 · TypeScript (запускається через `tsx`)
- **Frontend**: React 19 · Vite 6 · Tailwind CSS v3
- **Scraper**: `puppeteer-extra` + stealth plugin (системний Chromium у Docker)
- **LLM**: OpenAI, Anthropic, Google Gemini SDK
- **PDF**: `jspdf` + `jspdf-autotable` (Montserrat шрифт, фірмовий Netpeak-стиль)
- **Auth**: Google OAuth 2.0 Authorization Code flow з Workspace
  domain-restriction (`hd` claim) + JWT-сесія у HttpOnly cookie
- **Secrets**: Google Cloud Secret Manager
- **Deploy**: Google Cloud Run

---

## Локальна розробка

```bash
git clone https://github.com/<org>/contentaudit-ai.git
cd contentaudit-ai
cp .env.example .env
# Постав мінімум OPENAI_API_KEY. Якщо хочеш протестувати Workspace-auth локально,
# додай GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + SESSION_SECRET та
# додай http://localhost:3000/api/auth/callback у Authorized redirect URIs.

npm install
npm run dev    # http://localhost:3000 (Express + Vite middleware)
```

> Без `GOOGLE_CLIENT_ID` авторизація вимкнена — зручно для розробки.

---

## Деплой на Cloud Run (з нуля, новий GCP-проєкт)

### 0. Prerequisites

- GCP-проєкт з активованим білінгом
- Google Workspace організація з доменом, який матиме доступ
- `gcloud` CLI або **Cloud Shell** (рекомендую — там усе вже стоїть і
  залогінено)

### 1. Клон репозиторію

```bash
git clone https://github.com/<org>/contentaudit-ai.git
cd contentaudit-ai
```

### 2. Налаштування gcloud / Cloud Shell

```bash
# Підставити свої значення
export PROJECT_ID="your-project-id"
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
export REGION="europe-central2"
export SERVICE_NAME="contentaudit"
export REPO_NAME="contentaudit"

gcloud config set project "$PROJECT_ID"
gcloud config set run/region "$REGION"
gcloud config set artifacts/location "$REGION"

# Перевірка
gcloud config list
```

### 3. Увімкнути потрібні API

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com
```

### 4. Створити Artifact Registry для Docker-образів

```bash
gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --description="AI Content Audit images"
```

### 5. Покласти API-ключі LLM у Secret Manager

```bash
# Підставити справжні значення
printf '%s' "<openai-api-key>"    | gcloud secrets create ai-content-audit-openai    --data-file=-
printf '%s' "<anthropic-api-key>" | gcloud secrets create ai-content-audit-antropic  --data-file=-
printf '%s' "<gemini-api-key>"    | gcloud secrets create ai-content-audit-gemini    --data-file=-

# Якщо якогось ключа поки немає — створи з порожнім вмістом:
printf '%s' "" | gcloud secrets create ai-content-audit-gemini --data-file=-
# Цей провайдер буде показано як "not configured" у UI до додавання реального ключа.
```

### 6. Створити OAuth client у Google Cloud Console

1. Cloud Console → **APIs & Services → OAuth consent screen** → **User
   type: External** → опублікувати ("In production").
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `AI Content Audit`
3. У **Authorized redirect URIs** додати (тимчасово локалку — Cloud Run
   URL допишемо після деплою):
   ```
   http://localhost:3000/api/auth/callback
   ```
4. Натиснути **Create** → скопіювати **Client ID** і **Client Secret**.

### 7. Покласти Client ID, Client Secret і Session Secret у Secret Manager

```bash
# OAuth Client ID
printf '%s' "<oauth-client-id>" | gcloud secrets create ai-content-audit-google-client-id --data-file=-

# OAuth Client Secret
printf '%s' "<oauth-client-secret>" | gcloud secrets create ai-content-audit-google-client-secret --data-file=-

# Session signing secret (генеруємо 64 hex-символи)
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create ai-content-audit-session-secret --data-file=-
```

### 8. Дати runtime service account доступ до всіх секретів

Cloud Run за замовчуванням використовує `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`.

```bash
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in \
  ai-content-audit-openai \
  ai-content-audit-antropic \
  ai-content-audit-gemini \
  ai-content-audit-google-client-id \
  ai-content-audit-google-client-secret \
  ai-content-audit-session-secret; do
    gcloud secrets add-iam-policy-binding "$SECRET" \
      --member="serviceAccount:${SA}" \
      --role="roles/secretmanager.secretAccessor"
done
```

### 9. Покласти Netpeak-ассети у `public/`

Якщо ще немає — поклади:
- `public/netpeak-header.png` — широкий банер для PDF (горизонтальний, ~1230×90 px)
- `public/netpeak-footer-star.png` — маленька зірка-знак (~32×32 px)

Без них PDF побудується з програмним fallback-банером (текст замість картинки).

### 10. Білд Docker-образу

```bash
gcloud builds submit \
  --tag "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest" \
  .
```

Тривалість: 2–5 хвилин.

### 11. Деплой на Cloud Run

```bash
gcloud run deploy "$SERVICE_NAME" \
  --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 600 \
  --concurrency 20 \
  --min-instances 0 \
  --max-instances 5 \
  --set-env-vars "NODE_ENV=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},OPENAI_SECRET_NAME=projects/${PROJECT_NUMBER}/secrets/ai-content-audit-openai/versions/latest,ANTHROPIC_SECRET_NAME=projects/${PROJECT_NUMBER}/secrets/ai-content-audit-antropic/versions/latest,GEMINI_SECRET_NAME=projects/${PROJECT_NUMBER}/secrets/ai-content-audit-gemini/versions/latest,GOOGLE_CLIENT_ID_SECRET_NAME=projects/${PROJECT_NUMBER}/secrets/ai-content-audit-google-client-id/versions/latest,GOOGLE_CLIENT_SECRET_SECRET_NAME=projects/${PROJECT_NUMBER}/secrets/ai-content-audit-google-client-secret/versions/latest,SESSION_SECRET_NAME=projects/${PROJECT_NUMBER}/secrets/ai-content-audit-session-secret/versions/latest"
```

`--allow-unauthenticated` означає, що Cloud Run сам не блокує — наша аплікація
сама вимагає Google-логін (через `requireAuth` middleware).

### 12. Дописати Cloud Run URL у Authorized redirect URIs

```bash
URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')
echo "Cloud Run URL: $URL"
echo "Add to Authorized redirect URIs in OAuth client:"
echo "  ${URL}/api/auth/callback"
```

Відкрий Cloud Console → OAuth client → **Authorized redirect URIs** → додай
вище наведений URL (точно з `/api/auth/callback`, без слеша в кінці) → Save.

### 13. Перевірка

```bash
# Має повернути {"authEnabled":true,"allowedDomains":["netpeak.net","netpeak.group"]}
curl -s "${URL}/api/auth/config"

# Логи: шукай "[Auth] enabled=true"
gcloud run services logs read "$SERVICE_NAME" --region "$REGION" --limit 30 | grep -i auth

# Відкрий $URL у браузері (інкогніто, щоб не плутати з іншими акаунтами Google).
```

---

## Оновлення вже задеплоєного сервісу

**Тільки код змінився** (звичайний flow):
```bash
gcloud builds submit --tag "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest" .
gcloud run deploy "$SERVICE_NAME" \
  --image "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest" \
  --region "$REGION"
```

**Тільки env-змінні** (без перебілда образу):
```bash
gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --update-env-vars "KEY=value"
```

**Ротація секрету** (наприклад, новий OpenAI ключ):
```bash
printf '%s' "<new-key>" | gcloud secrets versions add ai-content-audit-openai --data-file=-
# Cloud Run читає секрети лише на boot — форсуємо новий ревіжн:
gcloud run services update "$SERVICE_NAME" --region "$REGION"
```

**Додати дозволений email поза доменом** (підрядник тощо):
```bash
gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --update-env-vars "ALLOWED_AUTH_EMAILS=external1@gmail.com,external2@example.com"
```

---

## Авторизація — як це працює для юзера

1. Юзер відкриває URL сервісу → бачить екран `Увійти через Google`.
2. Клік → редірект на `accounts.google.com` → обирає корпоративний акаунт.
3. Google повертає на `/api/auth/callback?code=…`.
4. Сервер обмінює `code` на ID-токен, перевіряє:
   - `email_verified === true`
   - `hd` (hosted domain) ∈ `ALLOWED_AUTH_DOMAINS`  **АБО** `email` ∈ `ALLOWED_AUTH_EMAILS`
5. Видає підписану JWT-сесію в HttpOnly-cookie на 12 годин.
6. Будь-який запит без сесії до `/api/openai|claude|gemini/*` чи `/api/scrape`
   повертає `401`.

**Юзеру не потрібно мати доступ до Google Cloud Console.** Достатньо
корпоративного Google-акаунта.

---

## Env-змінні (повний довідник)

Див. також [.env.example](.env.example).

### Обов'язкові на проді

| Змінна | Призначення |
|---|---|
| `NODE_ENV=production` | Вмикає продакшн-режим (cookies secure, static dist, misconfig-guard) |
| `GOOGLE_CLOUD_PROJECT` | Project ID, потрібно Secret Manager клієнту |
| `OPENAI_SECRET_NAME` | Resource path до Secret Manager-секрета з OpenAI key |
| `GOOGLE_CLIENT_ID_SECRET_NAME` *або* `GOOGLE_CLIENT_ID` | OAuth Web Client ID |
| `GOOGLE_CLIENT_SECRET_SECRET_NAME` *або* `GOOGLE_CLIENT_SECRET` | OAuth Client Secret |
| `SESSION_SECRET_NAME` *або* `SESSION_SECRET` | Ключ підпису JWT-сесії (64+ hex символів) |

### Опціональні

| Змінна | Дефолт | Призначення |
|---|---|---|
| `ANTHROPIC_SECRET_NAME` | — | Anthropic API key (без цього Claude недоступний) |
| `GEMINI_SECRET_NAME` | — | Gemini API key (без цього Gemini недоступний) |
| `ALLOWED_AUTH_DOMAINS` | `netpeak.net,netpeak.group` | Дозволені Workspace домени |
| `ALLOWED_AUTH_EMAILS` | (порожньо) | Окремі email-винятки |
| `OAUTH_REDIRECT_URI` | автодетект з реквесту | Явно задати callback URL (напр. за кастомним доменом) |
| `PORT` | `8080` | Дає сам Cloud Run; локально можна перевизначити |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` (у Docker) | Шлях до Chromium для скрапера |

---

## Структура репозиторію

```
.
├── App.tsx, index.tsx, index.html   # React frontend entrypoints
├── components/                       # UI components
│   ├── AuthGate.tsx                  # checks /api/auth/me, gates the app
│   ├── LoginScreen.tsx               # "Sign in with Google" screen
│   ├── BulkSummaryCard.tsx           # master strategy widget
│   ├── ResultCard.tsx                # per-URL audit card
│   └── ...                           # CriteriaSettings, ProxyModal, etc.
├── services/
│   ├── geminiService.ts              # LLM client (router by provider)
│   ├── scraperService.ts             # /api/scrape client
│   ├── pdfService.ts                 # Netpeak-styled PDF (3 variants)
│   ├── googleAuthService.ts          # auth client (config, login, logout)
│   └── ...
├── data/searchQualityGuidelines.ts   # Google SQEG cheat-sheet injected into prompts
├── server.ts                         # Express + auth + LLM endpoints + scraper
├── Dockerfile                        # Multi-stage Cloud Run image
├── public/                           # Static assets (Netpeak banner & star)
├── .env.example                      # Documented env-var template
└── README.md
```

---

## Troubleshooting

**`GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is missing — auth DISABLED`**
у логах → не задеплоєний `GOOGLE_CLIENT_SECRET_SECRET_NAME` або `GOOGLE_CLIENT_SECRET`.
Додати через `gcloud run services update` із потрібним env.

**`Error 400: redirect_uri_mismatch`** при логіні → точний Cloud Run URL не
доданий у **Authorized redirect URIs** OAuth-клієнта. Подивись повідомлення у
адресному рядку Google — який URL він очікує — і додай саме його.

**Залогінився, але одразу скидає на екран входу** → перевір, що
`SESSION_SECRET_NAME` заданий і runtime SA має до нього доступ. Без секрету
сесії генерується ефемерний ключ, який різні інстанси Cloud Run не діляться.

**`Analysis failed: 401 invalid x-api-key`** від Anthropic → значення в Secret
Manager має trailing newline. Код вже робить `.trim()`, але переконайся:
```bash
gcloud secrets versions access latest --secret=ai-content-audit-antropic | xxd | tail -1
# якщо в кінці бачиш "0a" — там \n, перезапиши:
printf '%s' "<key>" | gcloud secrets versions add ai-content-audit-antropic --data-file=-
```

**`Bulk audit JSON parse error`** → це обрив відповіді Claude. У коді вже
зашитий `jsonrepair` і збільшені `max_tokens`. Якщо повторюється — глянь
повний text у логах і відкрий issue.

**Юзеру треба тимчасовий доступ, він не в Netpeak Workspace** → додати email до
`ALLOWED_AUTH_EMAILS` через `gcloud run services update`.

---

## Команди-шпаргалка

```bash
# Логи в реальному часі
gcloud run services logs tail "$SERVICE_NAME" --region "$REGION"

# Поточний URL
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)'

# Які env-змінні зараз задеплоєні
gcloud run services describe "$SERVICE_NAME" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].env[].name)'

# Останній 30 рядків логу про auth
gcloud run services logs read "$SERVICE_NAME" --region "$REGION" --limit 30 | grep -i auth

# Список усіх секретів проєкту
gcloud secrets list --filter="name:ai-content-audit"
```

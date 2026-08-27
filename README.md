# RobinSood UTM Manager v1.1

نسخه اصلاح‌شده‌ای که **فقط مدیر اصلی به GitHub دسترسی دارد**.

مسئول مارکتینگ و مسئول فنی:
- GitHub Account لازم ندارند.
- GitHub Token لازم ندارند.
- Repository را نمی‌بینند.
- فقط با Username و Password داخلی UTM Manager وارد می‌شوند.

---

## معماری

```text
کاربر
  ↓
RobinSood UTM Manager
  ↓
Cloudflare Worker
  ├── Login داخلی
  ├── کنترل Role
  └── API امن
        ↓
GitHub Private Repository
        ├── UTM History
        ├── Definitions
        ├── User Password Hashes
        └── Excel / CSV
```

Secretهای GitHub فقط در Cloudflare Worker ذخیره می‌شوند و به Browser کاربران ارسال نمی‌شوند.

رابط کاربری و API هر دو توسط همان Cloudflare Worker ارائه می‌شوند؛ بنابراین GitHub Pages دیگر برای اجرای پنل لازم نیست.

---

# دسترسی کاربران

هر سه نفر فقط با اطلاعات داخلی پنل وارد می‌شوند:

```text
Owner
Marketing
Technical
```

هر سه نفر:
- UTM می‌سازند.
- History را می‌بینند.
- CSV و Excel می‌گیرند.
- Campaign / Source / Medium / Content Type / Creative / Audience جدید اضافه می‌کنند.

فقط Owner:
- UTM را Archive می‌کند.
- Delete احتیاطی انجام می‌دهد.
- Definition را Archive/Delete می‌کند.
- کاربران پنل را مدیریت می‌کند.
- Password کاربران را تغییر می‌دهد.

---

# ساختار UTM

```text
utm_source
utm_medium
utm_campaign
utm_content
utm_term
```

Sourceهای اولیه:

- `telegram` — تلگرام
- `instagram` — اینستاگرام
- `bale` — بله
- `rubika` — روبیکا
- `rubino` — روبینو
- `youtube` — یوتیوب
- `aparat` — آپارات
- `x` — ایکس
- `google` — گوگل
- `email_mercury` — ایمیل / پنل Mercury
- `sms_najva` — پیامک / پنل نجوا
- `sms_yektanet` — پیامک / پنل یکتانت
- `robinsood.com` — وب‌سایت رابین‌سود

Mediumهای اولیه:

- `owned_social` — سوشال رسانه‌های خودمان
- `paid_social` — سوشال رسانه دیگران با پرداخت هزینه
- `platform_ads` — تبلیغات رسمی خود پلتفرم مانند Telegram Ads
- `display` — تبلیغات بنری
- `cpc` — هزینه به‌ازای کلیک
- `referral` — رفرال
- `email` — ایمیل
- `sms` — پیامک

قاعده پیشنهادی: نام پنل ارسال در `utm_source` و نوع کانال در `utm_medium` ثبت می‌شود؛ مثال: `utm_source=email_mercury&utm_medium=email` یا `utm_source=sms_najva&utm_medium=sms`.

## پیش‌نیاز

روی کامپیوتر Node.js نصب باشد.

داخل پوشه پروژه:

```bash
npm install
```

سپس:

```bash
npx wrangler login
```

---

## Secret شماره 1 — GitHub Token

```bash
npx wrangler secret put GITHUB_TOKEN
```

وقتی مقدار خواست، GitHub Personal Access Token مدیر Repository را Paste کنید.

---

## Secret شماره 2 — Session Secret

یک رشته تصادفی طولانی، ترجیحاً حداقل 32 کاراکتر انتخاب کنید.

```bash
npx wrangler secret put SESSION_SECRET
```

این مقدار فقط برای امضای Session کاربران است.

---

## Secret شماره 3 — Bootstrap Secret

یک رمز جدا برای اولین راه‌اندازی انتخاب کنید:

```bash
npx wrangler secret put BOOTSTRAP_SECRET
```

این رمز فقط در اولین Setup پنل استفاده می‌شود.

مثلاً مدیر یک رمز طولانی تصادفی انتخاب می‌کند و آن را فقط تا پایان Setup نگه می‌دارد.

---

## Deploy

```bash
npx wrangler deploy
```

در پایان Cloudflare آدرس Worker را می‌دهد.

مثلاً:

```text
https://robinsood-utm-manager.<account>.workers.dev
```

این لینک ورود سه کاربر است.

---

# اولین ورود

اولین بار که لینک Worker باز شود، صفحه:

```text
راه‌اندازی اولیه
```

باز می‌شود.

در این صفحه باید:

1. Bootstrap Secret را وارد کنید.
2. اطلاعات Owner را تعریف کنید.
3. اطلاعات Marketing را تعریف کنید.
4. اطلاعات Technical را تعریف کنید.

برای هر نفر:
- نام نمایشی
- Username
- Password

Password باید حداقل 10 کاراکتر باشد.

بعد از ثبت، Setup غیرفعال می‌شود.

از آن لحظه هر سه کاربر فقط با Username / Password وارد UTM Manager می‌شوند.

---

# مهم: دو کاربر دیگر به چه چیزی نیاز دارند؟

فقط این دو مورد:

```text
لینک UTM Manager
Username + Password
```

نیاز ندارند به:

```text
❌ GitHub
❌ GitHub Account
❌ GitHub Token
❌ Repository Access
❌ Cloudflare
❌ Server
```

---

# خروجی Excel

Workflow آماده در:

```text
.github/workflows/build-exports.yml
```

وجود دارد.

چون GitHub گاهی هنگام Upload از طریق Browser فولدر مخفی `.github` را جا می‌اندازد، یک نسخه اضافه هم در:

```text
WORKFLOW-FILES/build-exports.yml
```

قرار داده شده.

اگر `.github` بعد از Upload وجود نداشت:

در GitHub:

```text
Add file
→ Create new file
```

نام فایل:

```text
.github/workflows/build-exports.yml
```

و محتوای فایل:

```text
WORKFLOW-FILES/build-exports.yml
```

را داخل آن Copy کنید.

---

# Workflow Permission

اگر Excel ساخته نشد، این بخش GitHub را بررسی کنید:

```text
Repository
→ Settings
→ Actions
→ General
→ Workflow permissions
```

Workflow باید بتواند فایل‌های:

```text
exports/utm_history.csv
exports/utm_history.xlsx
```

را Commit کند.

---

# نکته مهم درباره Actions

وقتی Worker یک UTM جدید ثبت می‌کند، GitHub Data تغییر می‌کند.

Workflow سپس خروجی‌های:

```text
CSV
XLSX
```

را دوباره تولید می‌کند.

پنل برای CSV به Workflow وابسته نیست و CSV را مستقیم هم می‌تواند تولید کند.

برای Excel، آخرین فایل ساخته‌شده داخل GitHub دانلود می‌شود.

---

# Archive / Delete

UTM بعد از ثبت Edit نمی‌شود.

اگر اشتباه باشد:

```text
Archive old UTM
→ Create new UTM
```

Delete احتیاطی نیز Physical Delete نیست.

فقط:

```text
status = deleted
```

می‌شود تا سابقه آماری از بین نرود.

---

# فایل‌های اصلی

```text
public/
  index.html
  style.css
  app.js

src/
  index.js

data/
  definitions.json
  record-index.json
  auth/
  records/

scripts/
  build_exports.py

.github/
  workflows/
    build-exports.yml

WORKFLOW-FILES/
  build-exports.yml

exports/
  utm_history.csv
  utm_history.xlsx

wrangler.jsonc
package.json
README.md
SECURITY.md
```

---

# اگر Repository قبلی v1 را دارید

بهتر است فایل‌های v1 را با این نسخه جایگزین کنید.

در نسخه 1.1:
- GitHub Token Login حذف شده.
- GitHub Pages برای اجرای پنل حذف شده.
- Login داخلی اضافه شده.
- Backend امن اضافه شده.
- GitHub Token فقط Server-side است.
- دو کاربر دیگر هیچ دسترسی GitHub لازم ندارند.

## رابط کاربری نسخه 1.3.0
- فرم ساخت UTM ساده‌تر و خواناتر شده است.
- برای Sourceهای ایمیل و پیامک، Medium مرتبط به‌صورت هوشمند انتخاب می‌شود.
- گزینه CPR حذف شده و CPC برای تبلیغات کلیکی باقی مانده است.
- چیدمان دسکتاپ و موبایل و پیش‌نمایش لینک بهینه شده است.


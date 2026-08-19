# راه‌اندازی خیلی کوتاه

## 1
پروژه را در یک GitHub Repository ترجیحاً Private آپلود کنید.

## 2
در `wrangler.jsonc` این دو مورد را اصلاح کنید:

```text
GITHUB_OWNER
GITHUB_REPO
```

## 3
در پوشه پروژه:

```bash
npm install
npx wrangler login
```

## 4
سه Secret:

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put SESSION_SECRET
npx wrangler secret put BOOTSTRAP_SECRET
```

## 5

```bash
npx wrangler deploy
```

## 6
لینک `workers.dev` را باز کنید.

## 7
در Setup اولیه Username و Password سه کاربر را تعریف کنید.

تمام.

دو عضو دیگر از اینجا به بعد فقط لینک پنل + Username + Password لازم دارند.

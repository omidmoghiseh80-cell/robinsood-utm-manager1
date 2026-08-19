# Security

## مدل امنیتی نسخه 1.1

GitHub Token هرگز داخل Frontend قرار نمی‌گیرد.

Secretهای حساس فقط در Cloudflare Worker Secrets قرار می‌گیرند:

```text
GITHUB_TOKEN
SESSION_SECRET
BOOTSTRAP_SECRET
```

این موارد را:
- داخل GitHub Commit نکنید.
- داخل `wrangler.jsonc` ننویسید.
- داخل `public/` قرار ندهید.

## Repository

Repository را Private نگه دارید.

## Password

Password کاربران به صورت Plain Text در GitHub ذخیره نمی‌شود.

در `data/auth/users.json` فقط PBKDF2-SHA256 Hash + Salt ذخیره می‌شود.

## Session

Sessionها با HMAC-SHA256 و `SESSION_SECRET` امضا می‌شوند و 12 ساعت اعتبار دارند.

## حذف دسترسی کاربر

Owner می‌تواند کاربر را Disable کند.

API در هر Request دوباره Active بودن کاربر را بررسی می‌کند؛ بنابراین Session کاربر غیرفعال‌شده نیز دیگر پذیرفته نمی‌شود.

## GitHub Token

Fine-grained Token را فقط به Repository همین پروژه و Permission لازم محدود کنید:

```text
Contents: Read and write
```

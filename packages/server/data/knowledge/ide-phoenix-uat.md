# IDE Phoenix — UAT Test Case

## Environment
- **URL:** https://ideuat.gammasprint.com/portal
- **Purpose:** UAT / Staging untuk ide-phoenix

## Credentials

### Admin
- **Email:** admin@example.com
- **Password:** Admin@123456

### Sales
- **Email:** sales@example.com
- **Password:** Sales@123456

---

## TC-01: Login Admin

### Browser Action Sequence
```json
[
  {"type": "navigate", "url": "https://ideuat.gammasprint.com/portal/users/sign_in"},
  {"type": "evaluate", "script": "document.querySelector('#portal_user_email').value='admin@example.com'; document.querySelector('#portal_user_password').value='Admin@123456'; document.querySelector('form').submit();"},
  {"type": "waitForSelector", "selector": ".sidebar, nav, [class*=sidebar]"},
  {"type": "screenshot"}
]
```

### Notes
- Fill + submit digabung dalam satu `evaluate` — lebih cepat dari 3 action terpisah
- `waitForSelector` setelah submit wajib, biar screenshot nunggu dashboard muncul
- Setting `.value` langsung via JS aman untuk Devise form (non-React)

### Python Snippet (login + kirim screenshot ke Telegram)
```python
import json, urllib.request, base64

BROWSER_URL = 'http://localhost:3001/api/browser/run'
SECRET = 'punakawan-x-secret-2026'
TG_TOKEN = '8732836699:AAGwqSuOZCpLg091oqH1vnEEYOE1O0rVxe8'
TG_CHAT = 8201379069

def browser(actions):
    payload = json.dumps({'actions': actions, 'screenshot': True}).encode()
    req = urllib.request.Request(BROWSER_URL, data=payload,
        headers={'Content-Type': 'application/json', 'x-webhook-secret': SECRET})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

def send_photo(path, caption=''):
    with open(path, 'rb') as f:
        img = f.read()
    body = (b'--b\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n' +
            str(TG_CHAT).encode() +
            b'\r\n--b\r\nContent-Disposition: form-data; name="photo"; filename="ss.png"\r\nContent-Type: image/png\r\n\r\n' +
            img + b'\r\n--b\r\nContent-Disposition: form-data; name="caption"\r\n\r\n' +
            caption.encode() + b'\r\n--b--\r\n')
    req = urllib.request.Request(f'https://api.telegram.org/bot{TG_TOKEN}/sendPhoto',
        data=body, headers={'Content-Type': 'multipart/form-data; boundary=b'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read()).get('ok')

def login(email, password):
    result = browser([
        {'type': 'navigate', 'url': 'https://ideuat.gammasprint.com/portal/users/sign_in'},
        {'type': 'evaluate', 'script': f"document.querySelector('#portal_user_email').value='{email}'; document.querySelector('#portal_user_password').value='{password}'; document.querySelector('form').submit();"},
        {'type': 'waitForSelector', 'selector': '.sidebar, nav, [class*=sidebar]'},
        {'type': 'screenshot'}
    ])
    ss = result.get('finalScreenshot')
    if ss:
        with open('/tmp/uat.png', 'wb') as f:
            f.write(base64.b64decode(ss))
        return '/tmp/uat.png'
    return None

# Login admin
path = login('admin@example.com', 'Admin@123456')
if path:
    send_photo(path, 'TC-01 Login Admin ✅')

# Login sales
path = login('sales@example.com', 'Sales@123456')
if path:
    send_photo(path, 'TC-01 Login Sales ✅')
```

---

## Test Cases (TBD)
- TC-02: Bikin product
- TC-03: dst

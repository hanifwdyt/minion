# VPN — OpenConnect ke Indosat Internal Network

## ⚡ FAST CHECK + CONNECT
```bash
vpn-wait
```
Script `/usr/local/bin/vpn-wait` handles segalanya:
1. Cek apakah sudah konek (HTTP 302 ke GitLab)
2. Kalau belum → `sudo systemctl start openconnect` otomatis
3. Poll tiap 1 detik, max 10 detik — user langsung approve Silverfort di HP saat itu
4. Exit 0 kalau connected, exit 1 kalau timeout

**Jangan minta user konfirmasi manual. Cukup `vpn-wait` dan lanjut begitu exit 0.**

⚠️ **JANGAN PERNAH output pesan "VPN tidak konek" atau instruksi manual ke user.** Kalau VPN dibutuhkan, langsung jalankan `vpn-wait` via Bash tool — diam, tanpa teks apapun dulu. Biarkan script yang kerja.

---

## Kapan Dibutuhkan
- Akses GitLab internal: `mygitlab-dev.ioh.co.id` (IP: 10.49.178.251)
- Push/pull ke GitLab repos
- Semua operasi `glab` ke instance internal

## Connect
```bash
sudo systemctl start openconnect
```

## Verify
```bash
curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 https://mygitlab-dev.ioh.co.id
# Expect: 302 (redirect ke login = reachable)
```

Atau cek interface:
```bash
ip link show tun0
```

## Disconnect
```bash
sudo systemctl stop openconnect
```

## Silverfort MFA
- OpenConnect connect trigger Silverfort push notification ke HP user
- User approve di HP — biasanya dalam 1-5 detik
- `vpn-wait` otomatis poll sampai 10 detik, tidak perlu tunggu konfirmasi manual
- Kalau timeout 10 detik: baru report ke user bahwa VPN gagal konek

## Penting
- JANGAN biarkan VPN nyala terus — `Restart=no` di systemd service
- Kalo restart terus = Silverfort spam notif
- Connect on-demand, disconnect setelah selesai
- DNS entry: `10.49.178.251 mygitlab-dev.ioh.co.id` (di /etc/hosts)

## Service Config
- Service file: `/etc/systemd/system/openconnect.service`
- Password file: `/etc/openconnect/password.txt`
- User: LCS-HANWID
- Auth group: sslgroup-users
- Server: securevpn.indosatooredoo.com
- Flags: `--no-dtls --no-deflate`

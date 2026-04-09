# VPN — OpenConnect ke Indosat Internal Network

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
- User harus approve di HP
- Kalo gagal connect setelah 30 detik, kemungkinan Silverfort belum di-approve
- Flow: start openconnect → minta user approve → tunggu konfirmasi → verify → lanjut

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

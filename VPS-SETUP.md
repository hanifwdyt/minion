# Punakawan VPS Setup Guide

## Prerequisites
- VPS: `77.42.43.106` (ubuntu-8gb-hel1-1)
- SSH: `ssh -o IdentitiesOnly=yes -i /tmp/coolify_key root@77.42.43.106`
- Domain: `punakawan.hanif.app` (DNS udah pointing)

---

## Step 1: Install Dependencies

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# Claude CLI
npm install -g @anthropic-ai/claude-code

# glab CLI
curl -s https://raw.githubusercontent.com/profclems/glab/trunk/scripts/install.sh | sudo bash

# PM2 (process manager)
npm install -g pm2

# Tools
sudo apt install -y git curl jq openconnect
```

## Step 2: Setup Claude CLI Auth

```bash
# Set OAuth token (persist di bashrc)
echo 'export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-Bl0UwAcL5iapi1gXnpUtosbyJ5Q8cGRrhcKIIN5xN0MeB0stKakfiNDMsYickA9cxLDCoxZvUyhVDS1IqoZFBA-vCHf9QAA"' >> ~/.bashrc
source ~/.bashrc

# Test
claude -p "say hello" --output-format text
```

## Step 3: Setup VPN (OpenConnect)

```bash
# Password file
sudo mkdir -p /etc/openconnect
echo "Hn42515@#D" | sudo tee /etc/openconnect/password.txt
sudo chmod 600 /etc/openconnect/password.txt

# Service file
sudo tee /etc/systemd/system/openconnect.service << 'EOF'
[Unit]
Description=OpenConnect VPN - Indosat
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/sbin/openconnect --user=LCS-HANWID --authgroup=sslgroup-users --passwd-on-stdin --no-dtls --no-deflate securevpn.indosatooredoo.com
ExecStop=/bin/kill -INT $MAINPID
Restart=no
StandardInput=file:/etc/openconnect/password.txt

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload

# DNS for internal GitLab
echo "10.49.178.251 mygitlab-dev.ioh.co.id" | sudo tee -a /etc/hosts
```

## Step 4: Setup glab (GitLab CLI)

```bash
# Connect VPN dulu
sudo systemctl start openconnect
# ⚠️ Approve Silverfort di HP!

# Auth glab
glab auth login --hostname mygitlab-dev.ioh.co.id
# Pilih: Token → paste Personal Access Token
# Protocol: HTTPS
# Authenticate Git: Yes

# Test
glab auth status

# Disconnect VPN
sudo systemctl stop openconnect
```

## Step 5: Clone Minion + Target Repos

```bash
# Clone minion
cd /root
git clone https://github.com/hanifwdyt/minion.git
cd minion

# Install & build
npm install
npm run build

# Buat directory buat GitLab repos
mkdir -p /root/repos

# Connect VPN dulu buat clone
sudo systemctl start openconnect
# ⚠️ Approve Silverfort di HP!

# Clone target repos (ganti dengan repo yang lo mau)
cd /root/repos
glab repo clone cco/cmo/group-digital-coe/div-smb-digital-product/ide-phoenix
# tambah repo lain sesuai kebutuhan...

# Disconnect VPN
sudo systemctl stop openconnect
```

## Step 6: Configure Minion

```bash
cd /root/minion

# Edit config — set tokens & project IDs
# Bisa edit langsung atau pake command di bawah
cat > packages/server/config-override.json << 'CONF'
{
  "integrations": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_TELEGRAM_BOT_TOKEN"
    },
    "gitlab": {
      "enabled": true,
      "webhookSecret": "",
      "instanceURL": "https://mygitlab-dev.ioh.co.id",
      "apiToken": "YOUR_GITLAB_PERSONAL_ACCESS_TOKEN",
      "defaultReviewer": "gareng",
      "mode": "poll",
      "projects": ["cco/cmo/group-digital-coe/div-smb-digital-product/ide-phoenix"]
    }
  }
}
CONF
```

### Bikin Telegram Bot
1. Chat `@BotFather` di Telegram
2. `/newbot` → kasih nama "Punakawan" → kasih username `punakawan_minion_bot` (atau apapun)
3. Copy token → paste di config di atas

### GitLab Personal Access Token
1. Buka `https://mygitlab-dev.ioh.co.id/-/user_settings/personal_access_tokens` (perlu VPN)
2. Create token dengan scope: `api`, `read_repository`, `write_repository`
3. Copy → paste di config di atas

## Step 7: Environment Variables

```bash
cat > /root/minion/.env << 'EOF'
PORT=3001
REPOS_BASE=/root/repos
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-Bl0UwAcL5iapi1gXnpUtosbyJ5Q8cGRrhcKIIN5xN0MeB0stKakfiNDMsYickA9cxLDCoxZvUyhVDS1IqoZFBA-vCHf9QAA
EOF
```

## Step 8: Start dengan PM2

```bash
cd /root/minion

# Start
pm2 start npm --name punakawan -- start

# Auto-start on reboot
pm2 startup
pm2 save

# Useful commands
pm2 logs punakawan        # Liat logs
pm2 restart punakawan     # Restart
pm2 stop punakawan        # Stop
pm2 monit                 # Monitor realtime
```

## Step 9: Reverse Proxy (optional, buat Web UI)

Kalo mau akses Web UI via `punakawan.hanif.app`, setup Caddy/Nginx reverse proxy:

```bash
# Install Caddy
sudo apt install -y caddy

# Config
sudo tee /etc/caddy/Caddyfile << 'EOF'
punakawan.hanif.app {
    reverse_proxy localhost:3001
}
EOF

sudo systemctl restart caddy
```

⚠️ Note: Kalo Coolify pake Traefik di port 80/443, lo perlu matiin Traefik dulu atau pake port lain.
Alternatif: setup reverse proxy via Coolify dashboard (Proxy → Custom).

## Step 10: Verify

```bash
# Check PM2
pm2 status

# Check server
curl -s http://localhost:3001/api/minions | jq '.[] | {id, name, status}'

# Check Telegram bot
# Kirim "halo" ke bot di Telegram — harusnya reply
```

---

## Troubleshooting

### Claude CLI error
```bash
# Cek token
echo $CLAUDE_CODE_OAUTH_TOKEN

# Test manual
claude -p "say hi" --output-format text
```

### VPN issues
```bash
# Cek status
sudo systemctl status openconnect

# Cek connectivity
curl -sk -o /dev/null -w "%{http_code}" https://mygitlab-dev.ioh.co.id

# Logs
sudo journalctl -u openconnect --since "5 min ago"
```

### Minion issues
```bash
# Logs
pm2 logs punakawan --lines 50

# Restart
pm2 restart punakawan
```

---

## Architecture

```
Telegram (HP/Laptop)
    │
    └──→ Minion Server (PM2, port 3001)
           │
           ├── Semar  ──→ Claude CLI ──→ code, git, glab
           ├── Gareng ──→ Claude CLI ──→ review, debug
           ├── Petruk ──→ Claude CLI ──→ frontend, creative
           └── Bagong ──→ Claude CLI ──→ quick fix, deploy
           │
           ├── VPN Manager (openconnect on-demand)
           ├── GitLab Poller (cek MR & discussions tiap 5 min)
           └── Knowledge Base (auto-learn dari interaksi)
```

## Flow Kerja

1. **Lo chat di Telegram**: "bikin fitur X di ide-phoenix"
2. **Semar delegate** ke minion yang cocok
3. **Minion connect VPN** → clone/pull repo → code → commit → push
4. **Lo review manual** di GitLab
5. **Lo bilang**: "bikin MR dari branch feat/X"
6. **Minion bikin MR** via glab
7. **Tech lead review** → comment @minion
8. **Minion auto-fix** → reply → resolve discussion
9. **VPN disconnect** setelah selesai

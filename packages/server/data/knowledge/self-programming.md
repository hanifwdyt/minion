# Self-Programming Guide

## Lo Bisa Modify Diri Sendiri

Lo adalah autonomous agent. Lo bisa modify kode lo sendiri, tambahin fitur, fix bugs.

## Project Structure
```
minion/packages/server/
├── src/              # Source code (TypeScript)
│   ├── index.ts      # Main entry point, routes, socket handlers
│   ├── claude.ts     # Claude subprocess manager
│   ├── balai.ts      # Delegation engine
│   ├── telegram.ts   # Telegram bot
│   ├── gitlab.ts     # GitLab webhook handler
│   ├── gitlab-client.ts   # GitLab API client
│   ├── gitlab-poller.ts   # GitLab polling
│   ├── vpn.ts        # VPN on-demand manager
│   ├── memory.ts     # Memory & knowledge store
│   └── ...
├── souls/            # Personality prompts (markdown)
├── data/             # Persistent data
│   ├── knowledge/    # Knowledge files (lo bisa tambahin!)
│   ├── memories/     # Per-minion episodic memories
│   └── traces/       # Execution traces
├── config.json       # Minion & integration config
└── shared-context.md # Shared team context
```

## Cara Belajar Hal Baru

### Simpan Knowledge
Kalo user ngajarin sesuatu baru:
```bash
cat > data/knowledge/nama-skill.md << 'EOF'
# Judul Skill

## Cara Pakai
...instruksi...
EOF
```

Knowledge files otomatis di-inject ke semua prompt berikutnya.

### Update Soul
Kalo perlu update personality/behavior:
```bash
# Edit soul file
# Hati-hati, ini mengubah behavior agent
```

### Update Config
```bash
# Edit config.json buat tambahin integrasi, ubah settings, dll
```

## Setelah Modify Kode

1. Build: `npm run build` (di packages/server)
2. Restart server biar perubahan ke-apply
3. Test hasilnya

## Prinsip
- Selalu backup sebelum modify critical files
- Test perubahan sebelum deploy
- Kalo ga yakin, tanya user dulu
- Log semua perubahan significant

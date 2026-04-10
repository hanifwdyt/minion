# Efficiency Insights

## Patterns yang Berhasil

- **glab CLI > curl** — Untuk semua MR operations, `glab` 3x lebih cepat dari curl manual. Sudah documented di gitlab-workflow.md.
- **Fast flows dulu** — Sebelum improvisasi, cek gitlab-workflow.md. Template 3-langkah ada di sana.
- **Petruk untuk implementasi besar** — Petruk fokus Bash + TodoWrite, cocok untuk sequential code tasks.
- **Gareng untuk analysis** — Gareng cocok untuk debugging, review, analisis — bukan GitLab ops.
- **Read tool langsung > Agent subagent** — Untuk eksplorasi kode, gunakan Read/Grep/Glob langsung. Agent subagent = new context = lebih lambat, lebih mahal, rawan context exhaustion.
- **CLAUDE.md di ide-phoenix** — Sudah ada di `/root/repos/ide-phoenix/CLAUDE.md` (403 baris). Selalu baca ini dulu sebelum kerja di project tersebut. Hemat 15-20 tool calls orientasi.

## Anti-Patterns (Hindari)

- **Curl manual untuk MR operations** — Root cause Gareng 117 Bash calls. glab selalu lebih singkat.
- **Agent subagent untuk GitLab tasks** — Spawn subagent = context baru = knowledge hilang = improv lagi. Lakukan langsung.
- **Agent subagent untuk explorasi UI/kode** — Semar UI rewrite failed (334s, 40 calls) karena pakai Agent subagent untuk explore. Pakai Read/Glob/Grep langsung.
- **Task besar tanpa decomposition** — Petruk timeout di "tambah filter search" karena scope-nya luas. Task > 5 menit kerja harus dipecah.
- **Heredoc cat append untuk JSON** — Rapuh dan rawan corruption. Gunakan Python untuk write/update JSON file.
- **Tulis semua UI dalam satu pass** — Context limit. Untuk task besar (>5 file yang harus diubah), bagi ke beberapa langkah: 1) baca & pahami, 2) rancang perubahan, 3) implementasi per komponen.

## Knowledge Gaps Teridentifikasi

1. **Proposals tracking** — Proposals tetap status "approved" meskipun sudah dieksekusi. Tidak ada mekanisme untuk mark "completed".
2. **Petruk task continuity** — Ketika user bilang "lanjutin dong", Petruk tidak punya context task sebelumnya. Sering fail.
3. **Gareng code investigation timeout** — Masih terjadi untuk task investigasi kode besar. Perlu template investigasi yang terbatas scope-nya.

## Templates & Shortcuts

### Cek VPN + Merge MR (3 langkah)
```bash
curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 https://mygitlab-dev.ioh.co.id
glab mr list
glab mr merge <IID> --squash --remove-source-branch
```

### Orientasi Project Cepat di ide-phoenix
```bash
cat /root/repos/ide-phoenix/CLAUDE.md   # sudah ada 403 baris, baca ini dulu
ls /root/repos/ide-phoenix/app/controllers/admin/
```

### Update proposals.json dengan Python (bukan heredoc)
```python
import json
with open('data/proposals.json') as f:
    d = json.load(f)
d.append({...new proposal dict...})
with open('data/proposals.json', 'w') as f:
    json.dump(d, f, indent=2)
```

### Large UI Task — Read-First Protocol
1. Glob seluruh component tree: `ls packages/web/src/components/**`
2. Read komponen kunci (max 5 file, yang paling sering dipakai)
3. Tulis rencana perubahan dulu ke TodoWrite
4. Implementasi per komponen, satu per satu

## Metrik Saat Ini (2026-04-10)

| Minion  | Success Rate | Total Tasks | Notes |
|---------|-------------|-------------|-------|
| Semar   | 80% (12/15) | 15 | 3 failed: UI rewrite, breath, |
| Gareng  | 89% (8/9)   | 9  | Improved setelah glab fix |
| Petruk  | 67% (4/6)   | 6  | Fail pada task ambigu & kontinuasi |
| Bagong  | 0% (0/3)    | 3  | VPN knowledge sudah diinjeksi via system |

## Metrik Target

- Task duration < 120s untuk operasi GitLab biasa
- Tool calls < 15 untuk task GitLab
- Tool calls < 30 untuk task implementasi medium
- Semar success rate > 85%
- Petruk success rate > 75%
- Gareng success rate > 90%
- Bagong success rate > 50% (tracking dari task baru)

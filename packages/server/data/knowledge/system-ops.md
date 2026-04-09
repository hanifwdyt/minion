# System Operations

## Service Management (systemd)
```bash
# Start/stop/restart service
sudo systemctl start <service>
sudo systemctl stop <service>
sudo systemctl restart <service>

# Check status
sudo systemctl status <service>

# View logs
sudo journalctl -u <service> --since "5 min ago" --no-pager
sudo journalctl -u <service> -f  # follow/tail

# Enable/disable on boot
sudo systemctl enable <service>
sudo systemctl disable <service>
```

## Known Services on VPS
- `openconnect` — VPN to Indosat internal network
- Minion server — running as node process (or PM2/systemd)

## Network
```bash
# Check interfaces
ip addr show
ip link show tun0  # VPN tunnel

# Check routing
ip route

# DNS lookup
nslookup <hostname>

# Test connectivity
curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 <url>
ping -c 1 <host>
```

## Process Management
```bash
# Find process
ps aux | grep <name>

# Kill process
kill <pid>
kill -9 <pid>  # force

# Check ports
ss -tlnp
```

## Package Management (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install -y <package>
sudo apt remove <package>
```

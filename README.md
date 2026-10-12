# ZKTeco ADMS Mock Server

A **debug/mock** Express + TypeScript server that pretends to be a ZKTeco ADMS
(Push) server. Its only job: prove that your biometric device can reach your
machine and push data — and show you *exactly* what it sends.

> **Not production code.** No auth, no DB, everything answers `200 OK`.

---

## Quick start

```bash
npm install
npm run dev          # tsx watch src/index.ts  (live reload)
```

Other commands:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # compile to dist/
npm start            # run compiled dist/index.js
npm run logs:clear   # empty logs/device-requests.log
```

### Device settings

On the device (or in ZKAccess / zk device config tool):

| Field         | Value                                   |
| ------------- | --------------------------------------- |
| Server Mode   | **ADMS** (Push / iClock)                |
| Server Address| your PC's LAN IP (see banner)           |
| Server Port   | **8081**                                |

The banner prints your LAN IP at startup — a device can **not** reach `127.0.0.1`.

---

## Making the server reachable by anyone on your network

The server binds to `0.0.0.0:8081`, so it already listens on **every**
interface. Two things are additionally needed:

**1. Windows Firewall — allow inbound TCP 8081** (run PowerShell *as
Administrator*, once):

```powershell
New-NetFirewallRule -DisplayName "ZKTeco ADMS Mock 8081" `
  -Direction Inbound -Protocol TCP -LocalPort 8081 `
  -Action Allow -Profile Private,Domain
```

Remove it later with:

```powershell
Remove-NetFirewallRule -DisplayName "ZKTeco ADMS Mock 8081"
```

**2. Use a stable LAN IP.** DHCP may change your address after a reboot;
give the machine a DHCP reservation or static IP on your router.

### Verify from another device on the same network

```bash
curl http://<server-lan-ip>:8081/health
curl http://<server-lan-ip>:8081/debug/network
```

Both must return `200`. If they don't: same Wi-Fi/VLAN? firewall rule
present? router not blocking client-to-client traffic (some mesh/APs do)?

### Current machine

| Setting  | Value |
| -------- | ----- |
| Bind     | `0.0.0.0:8081` (all interfaces) |
| LAN IP   | `192.168.2.68` (Wi-Fi) — use this as Server Address |
| Firewall | rule `ZKTeco ADMS Mock 8081` (inbound TCP 8081, Private+Domain) |

> Anyone on the same LAN can now reach this server. It is a **mock/debug**
> server with no authentication — do not port-forward it to the internet.

---

## What is ZKTeco ADMS?

ADMS (*Asynchronous Data Management System*) is ZKTeco's **push** protocol.
Instead of your PC polling the device over TCP 4370 with the proprietary SDK,
the **device is the HTTP client**: it calls out to the URL you configured and
uploads its data.

### Why `/iclock/*`?

ZKTeco firmware speaks the legacy *iClock* HTTP dialect. The paths are fixed:

| Call | Direction | Meaning |
| --- | --- | --- |
| `GET /iclock/cdata?SN=..&Stamp=..` | device → server | registration + heartbeat. Server replies `OK` + `Stamp=<n>` |
| `POST /iclock/cdata?SN=..&table=ATTLOG` | device → server | the actual upload (punches, users, templates) |
| `GET /iclock/getrequest?SN=..` | device → server | "any commands for me?" → reply `OK` = none |
| `GET\|POST /iclock/devicecmd?SN=..&CMD=..` | device → server | ack of a command we issued (`Result: 0`) |
| anything else under `/iclock/*` | device → server | unknown; we still return 200 |

### How attendance is pushed

1. Device boots → `GET /iclock/cdata` (registration).
2. Device heartbeats every few seconds → `GET /iclock/cdata`.
3. Someone punches → row written to `ATTLOG` on the device.
4. Our reply carries a **Stamp newer** than the device's → device uploads:
   `POST /iclock/cdata?SN=XXXX&table=ATTLOG`
5. We reply `OK` → device advances its cursor.

`ATTLOG` body — TAB-separated, one punch per line:

```
0	1001	1	2024-05-04 09:01:22	0	0
│  │    │  │                    │  │
sn pin verified time            action workcode
```

Other tables: `USERINFO`, `FINGER` / `TEMPLATE` (encoded biometric templates),
`OPERLOG`, `SYSLOG`.

### What to capture for protocol analysis

* client IP + **all** headers (User-Agent hints at firmware family)
* full query string — `SN`, `table`, `Stamp`, `Flag`, `TransFlag`, `ErrorUpdate`
* **raw body, byte-exact** (never `JSON.parse` it; encoding may be GBK)
* method + exact path (some firmware uses GET with `?TransFlag=`)
* our response status/body and the timing between heartbeat and push

---

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/iclock/cdata` | GET/POST | registration, heartbeat, data upload |
| `/iclock/getrequest` | GET/POST | command polling |
| `/iclock/devicecmd` | ALL | command acknowledgement |
| `/iclock/*` | ALL | unknown device paths → `200 OK` |
| catch-all | ALL | anything else → `200 OK` |
| `/health` | GET | `{"status":"ok"}` |
| `/logs` | GET | **device traffic only** (`/iclock/*`); `?all=1` = everything |
| `/punches` | GET | **punches only** (`?sn=`, `?limit=`, default 200) — Nepal time |
| `/punches.csv` | GET | per-punch CSV — `punchType` column says `CheckIn`/`CheckOut` |
| `/attendance` | GET | **one row/employee/day: `checkIn` + `checkOut`** (Nepal time) |
| `/attendance.csv` | GET | same rows as CSV — has **both** check-in and check-out columns |
| `/attendence`, `/attendence.csv` | GET | typo aliases of `/attendance[.csv]` |
| `/debug/network` | GET | `{"serverIp":"..","port":8081,"time":".."}` |

### Which CSV do I want?

| Need | URL | Columns |
| --- | --- | --- |
| Every punch, one row each | `/punches.csv` | `punchTimeNepal`, `punchType` (`CheckIn`/`CheckOut`), `status`, `verifiedLabel` … |
| **Daily summary with separate in/out times** | **`/attendance.csv`** | `date`, **`checkIn`**, **`checkOut`**, `checkInIso`, `checkOutIso`, `workedMinutes`, `worked`, `punchCount` … |

`/attendance` filters: `?sn=` `?pin=` `?from=YYYY-MM-DD` `?to=YYYY-MM-DD` `?limit=`

```bash
curl http://localhost:8081/attendance
curl http://localhost:8081/attendance?pin=1001&from=2026-10-01&to=2026-10-05
curl -OJ http://localhost:8081/attendance.csv
```

```json
{
  "count": 1,
  "serverTimeNepal": "2026-10-05 13:29:44",
  "attendance": [
    {
      "sn": "ACCE19240001",
      "pin": "1001",
      "date": "2026-10-05",
      "checkIn": "08:59:58",
      "checkOut": "18:00:05",
      "checkInIso": "2026-10-05T08:59:58+05:45",
      "checkOutIso": "2026-10-05T18:00:05+05:45",
      "workedMinutes": 540,
      "worked": "9h 00m",
      "punchCount": 2,
      "checkInVerified": "Fingerprint",
      "checkOutVerified": "Fingerprint"
    }
  ]
}
```

Pairing rules: if the device sends real codes, earliest `status=0` → `checkIn`,
latest `status=1` → `checkOut`; if it sends the same code for every punch,
first/last punch of the Nepal day is used (a lone punch = check-in only).
Days are grouped by **Nepal date**, so midnight-crossing shifts split correctly.

### Timezones

* Device clocks have no timezone — `DEVICE_CLOCK_TZ` (`.env`, default
  `Asia/Kathmandu`) says what the device's wall-clock means.
* All output is rendered in `REPORT_TZ` (default `Asia/Kathmandu`, `+05:45`).
* Each punch carries `timestamp` (raw), `timestampNepal`, `timestampIso`
  (`+05:45`) and `timestampUtc`.

### `/punches` — raw punch view

`/logs` shows *every* HTTP request (health checks, favicons, device traffic).
`/punches` shows **only the punches**, merged from memory + `logs/device-requests.log`
so they survive a restart:

```bash
curl http://localhost:8081/punches
curl http://localhost:8081/punches?sn=ACCE19240001&limit=50
curl -OJ http://localhost:8081/punches.csv
```

```json
{
  "count": 1,
  "serverTimeNepal": "2026-10-05 13:29:44",
  "punches": [
    {
      "recordId": 3,
      "receivedAt": "2026-10-05T06:56:27.314Z",
      "sn": "ZKTEST001",
      "deviceIp": "192.168.2.68",
      "pin": "2001",
      "timestamp": "2026-10-05 08:59:58",
      "timestampNepal": "2026-10-05 08:59:58",
      "timestampIso": "2026-10-05T08:59:58+05:45",
      "timestampUtc": "2026-10-05T03:14:58Z",
      "status": "0",
      "statusLabel": "CheckIn",
      "punchType": "CheckIn",
      "verified": "1",
      "verifiedLabel": "Fingerprint",
      "workcode": "0",
      "path": "/iclock/cdata"
    }
  ]
}
```

Every request is:

* printed as a readable block in the console,
* appended to `logs/device-requests.log` (JSONL, one object per line),
* kept in an in-memory ring buffer (500 max) that `/logs` reads.

---

## Example console output

### 1) Device registration

```
────────────────────────────────────────────────────────────────────────
[0001] REGISTRATION  2024-05-04 08:59:01.104
  Endpoint : GET /iclock/cdata?SN=ACCE19240001&Stamp=1&ErrorUpdate=0&TransFlag=111111100
  Client   : 192.168.1.57
  Device   : SN=ACCE19240001
  Headers  : {"host":"192.168.1.10:8081","user-agent":"Linux Agent","connection":"close"}
  Query    : {"SN":"ACCE19240001","Stamp":"1","ErrorUpdate":"0","TransFlag":"111111100"}
  Raw body : (empty)
  Response : 200
```

### 2) Device heartbeat / polling

```
────────────────────────────────────────────────────────────────────────
[0002] HEARTBEAT  2024-05-04 08:59:06.221
  Endpoint : GET /iclock/cdata?SN=ACCE19240001&Stamp=2&ErrorUpdate=0&TransFlag=111111100
  Client   : 192.168.1.57
  Device   : SN=ACCE19240001
  Headers  : {"host":"192.168.1.10:8081","user-agent":"Linux Agent","connection":"close"}
  Query    : {"SN":"ACCE19240001","Stamp":"2","ErrorUpdate":"0","TransFlag":"111111100"}
  Raw body : (empty)
  Response : 200
```

### 3) Employee fingerprint punch upload

```
────────────────────────────────────────────────────────────────────────
[0003] ATTENDANCE-PUSH  2024-05-04 09:01:25.870
  Endpoint : POST /iclock/cdata?SN=ACCE19240001&table=ATTLOG&Stamp=3&FrameFlag=1
  Client   : 192.168.1.57
  Device   : SN=ACCE19240001
  Table    : ATTLOG
  Headers  : {"content-type":"text/plain","content-length":"35","user-agent":"Linux Agent"}
  Query    : {"SN":"ACCE19240001","table":"ATTLOG","Stamp":"3","FrameFlag":"1"}
  Raw body :
    0	1001	1	2024-05-04 09:01:22	0	0
  Parsed punches (1):
    pin=1001  time=2024-05-04 09:01:22  status=0  verified=1  workcode=0
  Response : 200
```

*(tabs in the body are real tabs — shown here as wide gaps)*

---

## Project structure

```
zkteco-adms-mock/
├── package.json
├── tsconfig.json
├── .env                  # PORT=8081, HOST=0.0.0.0, HISTORY_MAX=500
├── logs/
│   └── device-requests.log   # created at runtime (JSONL)
└── src/
    ├── index.ts          # listen + startup banner
    ├── app.ts            # middleware order + routes + error handler
    ├── config.ts         # dotenv config
    ├── types.ts          # RequestRecord, PunchRecord, ...
    ├── middleware/
    │   ├── rawBody.ts        # BYTE-EXACT body capture (plain-text payloads)
    │   ├── requestLogger.ts  # record -> history + file + console
    │   └── morgan.ts         # access log -> console + file
    ├── routes/
    │   ├── adms.ts       # /iclock/* handlers (always 200 OK)
    │   ├── system.ts     # /health, /logs, /debug/network
    │   └── index.ts      # assembly + catch-all
    ├── services/
    │   ├── history.ts    # in-memory ring buffer (no DB)
    │   ├── fileLogger.ts # JSONL append
    │   ├── punches.ts    # /punches: merge memory+file, flatten, CSV
    │   ├── parser.ts     # protocol docs + SN/table/ATTLOG parsing
    │   └── network.ts    # LAN IP detection
    └── utils/
        ├── banner.ts     # startup banner
        └── format.ts     # console colors/pretty printing
```

---

## Extending into a real ingestion service

The seams are already in place:

1. **Persist punches** — in `src/middleware/requestLogger.ts` the finished
   `record` (with `record.punches`, `record.deviceSn`, `record.clientIp`) is
   the single place to write to your DB instead of `pushRecord`/`appendRecord`.
2. **Issue commands** — `GET /iclock/getrequest` in `routes/adms.ts` currently
   returns `OK`; return a queued command string instead.
3. **Replace memory** — `services/history.ts` exposes only
   `pushRecord/lastRecords/recordCount`; swap the array for Postgres/Redis.
4. **Replace the file logger** — `services/fileLogger.ts` is a thin
   `appendRecord`; swap for pino/winston with rotation.
5. **Security** — validate `SN` against an allow-list, add a shared token,
   put it behind HTTPS/nginx before exposing it to a network.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No traffic at all | Device must reach your **LAN IP**, not `127.0.0.1`. Check firewall allows inbound **8081/tcp**. |
| `EADDRINUSE` | Another process holds 8081 — change `PORT` in `.env` (and on the device). |
| Device shows "server offline" | Answer must be HTTP 200 (we do). Check MTU/VPN; try the IP not a hostname. |
| Garbled Chinese in body | Firmware sends GBK; the raw bytes are preserved, only the UTF-8 view may be mangled. |
| Nothing pushes | Some firmware only uploads when the returned `Stamp` differs from its own — our heartbeat stamp increments each call. |

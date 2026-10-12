/**
 * Startup banner — printed once the HTTP server is actually listening.
 */
import { config } from '../config';
import { c, nowStamp } from './format';
import { detectLanIp, listLanIps } from '../services/network';

export function printBanner(): void {
  const lanIp = detectLanIp();
  const border = '='.repeat(34);

  console.log('');
  console.log(c.bold(c.green(border)));
  console.log(c.bold(c.green('  ZKTeco ADMS Mock Server Running')));
  console.log(c.bold(`  Listening on: ${config.host}:${config.port}`));
  console.log(c.bold(`  Health: http://localhost:${config.port}/health`));
  console.log(c.bold(c.green(border)));
  console.log('');
  console.log(c.cyan('  Device settings to use:'));
  console.log(`    Server Mode    : ${c.bold('ADMS')}`);
  console.log(`    Server Address : ${c.bold(lanIp)}   ${c.dim('(this machine)')}`);
  console.log(`    Server Port    : ${c.bold(String(config.port))}`);
  const others = listLanIps().filter((ip) => ip !== lanIp);
  if (others.length) {
    console.log(c.dim(`    Other local IPs: ${others.join(', ')}`));
  }
  console.log('');
  console.log(c.cyan('  Endpoints (exact URLs):'));
  console.log(`    GET  /health                    ${c.dim('-> { status: "ok" }')}`);
  console.log(`    GET  /logs                      ${c.dim('-> device traffic only; ?all=1 = everything')}`);
  console.log(`    GET  /punches                   ${c.dim('-> punches only (?sn=&limit=)')}`);
  console.log(`    GET  /punches.csv               ${c.dim('-> per-punch CSV (punchType = CheckIn/CheckOut)')}`);
  console.log(`    GET  /attendance                ${c.dim('-> checkIn + checkOut per day (Nepal)')}`);
  console.log(`    GET  /attendance.csv            ${c.dim('-> checkIn AND checkOut columns (CSV)')}`);
  console.log(`    GET  /attendance.csv?pin=1001   ${c.dim('-> filtered by employee')}`);
  console.log(`    GET  /debug/network             ${c.dim('-> server ip/port/time')}`);
  console.log(`    *    /iclock/*                  ${c.dim('-> device traffic (returns 200)')}`);
  console.log(c.dim(`    typo alias: /attendence[.csv] also works -> /attendance[.csv]`));
  console.log('');
  console.log(c.cyan('  Timezone:'));
  console.log(`    device clock : ${c.bold(config.deviceClockTz)} ${c.dim('(DEVICE_CLOCK_TZ in .env)')}`);
  console.log(`    reported in  : ${c.bold(config.reportTz)} ${c.dim('(REPORT_TZ in .env)')}`);
  console.log('');
  console.log(c.dim(`  Started at ${nowStamp()}`));
  console.log(c.dim(`  Log file  : logs/device-requests.log`));
  console.log('');
}

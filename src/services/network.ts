/**
 * Detects this machine's LAN IP address so the device's "Server Address"
 * field can be filled in correctly (a device cannot reach 127.0.0.1).
 */
import os from 'os';

/** Node reports family as 'IPv4' (some runtimes report the number 4). */
function isIPv4(family: string | number): boolean {
  return String(family) === 'IPv4' || String(family) === '4';
}

/**
 * Returns the first non-internal IPv4 address found on this machine,
 * or '127.0.0.1' as a last resort.
 */
export function detectLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name] || [];
    for (const iface of list) {
      // Skip IPv6 and loopback entries.
      if (!isIPv4(iface.family)) continue;
      if (iface.internal) continue;
      return iface.address;
    }
  }
  return '127.0.0.1';
}

/** All IPv4 addresses (useful when the machine has several NICs). */
export function listLanIps(): string[] {
  const out: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!isIPv4(iface.family)) continue;
      if (iface.internal) continue;
      out.push(iface.address);
    }
  }
  return out;
}

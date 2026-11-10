import fs from 'node:fs/promises';
import path from 'node:path';

async function chownRecursive(target, uid, gid) {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    return;
  }
  if (stat.uid !== uid || stat.gid !== gid) await fs.lchown(target, uid, gid);
  if (stat.isDirectory()) {
    for (const name of await fs.readdir(target)) await chownRecursive(path.join(target, name), uid, gid);
  }
}

// In Docker the container starts as root so it can make the mounted data folder
// owned by PUID:PGID (your host user), then it drops to that user for good.
// Does nothing when not running as root or when PUID isn't set.
export async function dropPrivileges(dirs) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return null;
  if (!process.env.PUID) return null;
  const uid = Number(process.env.PUID);
  const gid = Number(process.env.PGID ?? process.env.PUID);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid === 0) return null;
  for (const dir of dirs.filter(Boolean)) {
    await fs.mkdir(dir, { recursive: true });
    await chownRecursive(dir, uid, gid);
  }
  process.setgroups?.([gid]);
  process.setgid(gid);
  process.setuid(uid);
  return { uid, gid };
}

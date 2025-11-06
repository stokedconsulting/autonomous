/**
 * Process utilities for checking and managing processes
 */

import { execSync } from 'child_process';

/**
 * Check if a process is a zombie (defunct) process
 * @param pid Process ID to check
 * @returns true if process is a zombie, false otherwise
 */
export function isZombieProcess(pid: number): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    // On macOS and Linux, use ps to check process state
    const output = execSync(`ps -p ${pid} -o state=`, { encoding: 'utf-8' }).trim();
    // 'Z' indicates a zombie process
    return output === 'Z' || output.startsWith('Z');
  } catch (error) {
    // If ps command fails, process doesn't exist or we can't check
    return false;
  }
}

/**
 * Check if a process is currently running (excluding zombies)
 * @param pid Process ID to check
 * @returns true if process is running and not a zombie, false otherwise
 */
export function isProcessRunning(pid: number): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    // Use kill signal 0 to check if process exists without actually killing it
    // This works on Unix-like systems (macOS, Linux)
    process.kill(pid, 0);

    // Process exists, but check if it's a zombie
    if (isZombieProcess(pid)) {
      return false;  // Treat zombies as not running
    }

    return true;
  } catch (error: any) {
    // ESRCH means "No such process"
    if (error.code === 'ESRCH') {
      return false;
    }
    // EPERM means process exists but we don't have permission to signal it
    // In this case, the process is still running (check for zombie)
    if (error.code === 'EPERM') {
      return !isZombieProcess(pid);
    }
    // For any other error, assume process is not running
    return false;
  }
}

/**
 * Get process info if it exists
 * Returns basic info about a process or null if it doesn't exist
 */
export function getProcessInfo(pid: number): { pid: number; exists: boolean; isZombie: boolean } | null {
  if (!pid || pid <= 0) {
    return null;
  }

  const isZombie = isZombieProcess(pid);
  const exists = !isZombie && isProcessRunning(pid);
  return { pid, exists, isZombie };
}

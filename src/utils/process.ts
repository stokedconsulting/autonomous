/**
 * Process utilities for checking and managing processes
 */

/**
 * Check if a process is currently running
 * @param pid Process ID to check
 * @returns true if process is running, false otherwise
 */
export function isProcessRunning(pid: number): boolean {
  if (!pid || pid <= 0) {
    return false;
  }

  try {
    // Use kill signal 0 to check if process exists without actually killing it
    // This works on Unix-like systems (macOS, Linux)
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    // ESRCH means "No such process"
    if (error.code === 'ESRCH') {
      return false;
    }
    // EPERM means process exists but we don't have permission to signal it
    // In this case, the process is still running
    if (error.code === 'EPERM') {
      return true;
    }
    // For any other error, assume process is not running
    return false;
  }
}

/**
 * Get process info if it exists
 * Returns basic info about a process or null if it doesn't exist
 */
export function getProcessInfo(pid: number): { pid: number; exists: boolean } | null {
  if (!pid || pid <= 0) {
    return null;
  }

  const exists = isProcessRunning(pid);
  return { pid, exists };
}

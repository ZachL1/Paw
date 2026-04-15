export const isMac =
  navigator.platform.toUpperCase().includes("MAC") ||
  navigator.platform.includes("Mac");

export const isLinux =
  navigator.platform.toUpperCase().includes("LINUX") ||
  navigator.userAgent.toUpperCase().includes("LINUX");

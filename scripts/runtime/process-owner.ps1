# Query the actual Windows process token without repeated WMI GetOwner calls.
function Get-MnpProcessOwnerSid([int]$ProcessId) {
    if (-not ('MnpRuntimeProcessToken' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class MnpRuntimeProcessToken {
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static string OwnerSid(int pid) {
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) throw new Win32Exception();
        IntPtr token = IntPtr.Zero;
        try {
            if (!OpenProcessToken(process, 0x0008, out token)) throw new Win32Exception();
            using (var identity = new WindowsIdentity(token)) return identity.User.Value;
        } finally {
            if (token != IntPtr.Zero) CloseHandle(token);
            CloseHandle(process);
        }
    }
}
'@
    }
    return [MnpRuntimeProcessToken]::OwnerSid($ProcessId)
}

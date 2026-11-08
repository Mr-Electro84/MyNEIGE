# Read-only SetupAPI probe. A staged TAP driver need not have an active device,
# service or a copy under System32\drivers yet. Never create a network adapter.
function Get-OpenVpnTapDriver {
    if (!('MyNeige.TapDriverStore' -as [type])) {
        $source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace MyNeige {
    public static class TapDriverStore {
        const uint ClassDriver = 1;
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = TAP_PACK)]
        struct DriverInfo {
            public uint Size, Type;
            public UIntPtr Reserved;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Description;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Manufacturer;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Provider;
            public System.Runtime.InteropServices.ComTypes.FILETIME Date;
            public ulong Version;
        }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode, Pack = TAP_PACK)]
        struct DriverDetail {
            public uint Size;
            public System.Runtime.InteropServices.ComTypes.FILETIME Date;
            public uint CompatibleOffset, CompatibleLength;
            public UIntPtr Reserved;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Section;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string InfPath;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Description;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 1)] public string HardwareId;
        }
        [DllImport("setupapi.dll", SetLastError = true)]
        static extern IntPtr SetupDiCreateDeviceInfoList(ref Guid guid, IntPtr owner);
        [DllImport("setupapi.dll", SetLastError = true)]
        static extern bool SetupDiBuildDriverInfoList(IntPtr set, IntPtr device, uint kind);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool SetupDiEnumDriverInfoW(IntPtr set, IntPtr device, uint kind, uint index, ref DriverInfo data);
        [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool SetupDiGetDriverInfoDetailW(IntPtr set, IntPtr device, ref DriverInfo data, IntPtr detail, uint size, out uint required);
        [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDriverInfoList(IntPtr set, IntPtr device, uint kind);
        [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
        public static bool IsTapHardwareId(string id) {
            return String.Equals(id, "tap0901", StringComparison.OrdinalIgnoreCase) ||
                   String.Equals(id, @"root\tap0901", StringComparison.OrdinalIgnoreCase);
        }
        public static string Find() {
            Guid net = new Guid("4d36e972-e325-11ce-bfc1-08002be10318");
            IntPtr set = SetupDiCreateDeviceInfoList(ref net, IntPtr.Zero);
            if (set == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
            bool built = false;
            try {
                if (!SetupDiBuildDriverInfoList(set, IntPtr.Zero, ClassDriver)) throw new Win32Exception(Marshal.GetLastWin32Error());
                built = true;
                for (uint index = 0; ; index++) {
                    DriverInfo info = new DriverInfo(); info.Size = (uint)Marshal.SizeOf(typeof(DriverInfo));
                    if (!SetupDiEnumDriverInfoW(set, IntPtr.Zero, ClassDriver, index, ref info)) {
                        int error = Marshal.GetLastWin32Error();
                        if (error == 259) return "";
                        throw new Win32Exception(error);
                    }
                    uint required;
                    SetupDiGetDriverInfoDetailW(set, IntPtr.Zero, ref info, IntPtr.Zero, 0, out required);
                    int probeError = Marshal.GetLastWin32Error();
                    int offset = (int)Marshal.OffsetOf(typeof(DriverDetail), "HardwareId");
                    if (probeError != 122 || required < offset + 2 || required > 1048576)
                        throw new Win32Exception(probeError, "Invalid network driver metadata: error=" + probeError + " bytes=" + required);
                    uint capacity = Math.Max(required, (uint)Marshal.SizeOf(typeof(DriverDetail)));
                    IntPtr buffer = Marshal.AllocHGlobal((int)capacity);
                    try {
                        Marshal.WriteInt32(buffer, Marshal.SizeOf(typeof(DriverDetail)));
                        if (!SetupDiGetDriverInfoDetailW(set, IntPtr.Zero, ref info, buffer, capacity, out required))
                            throw new Win32Exception(Marshal.GetLastWin32Error());
                        string ids = Marshal.PtrToStringUni(IntPtr.Add(buffer, offset), ((int)required - offset) / 2);
                        foreach (string id in ids.Split('\0')) {
                            if (IsTapHardwareId(id)) {
                                DriverDetail detail = (DriverDetail)Marshal.PtrToStructure(buffer, typeof(DriverDetail));
                                return detail.InfPath;
                            }
                        }
                    } finally { Marshal.FreeHGlobal(buffer); }
                }
            } finally {
                if (built) SetupDiDestroyDriverInfoList(set, IntPtr.Zero, ClassDriver);
                SetupDiDestroyDeviceInfoList(set);
            }
        }
    }
}
'@
        # setupapi.h impose pack(1) aux processus 32 bits et pack(8) aux 64 bits.
        # Windows PowerShell peut etre x86 meme sur un systeme ARM64.
        $packing = if ([IntPtr]::Size -eq 8) { '8' } else { '1' }
        Add-Type -TypeDefinition ($source.Replace('TAP_PACK', $packing))
    }
    return [MyNeige.TapDriverStore]::Find()
}

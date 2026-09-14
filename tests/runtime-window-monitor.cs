using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Observe SHOW events before process creation, on a dedicated message-pump thread.
// A post-start IsWindowVisible check cannot detect an earlier console flash.
public sealed class MnpWindowMonitor : IDisposable
{
    public sealed class Observation
    {
        public int ProcessId;
        public int[] Ancestry;
        public string WindowClass;
    }
    delegate void WinEventCallback(IntPtr hook, uint evt, IntPtr window, int obj, int child, uint thread, uint time);
    [StructLayout(LayoutKind.Sequential)] struct Message { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x, y; public uint extra; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr reserved1, peb, reserved2, reserved3, pid, parent; }
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventCallback callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern bool PeekMessage(out Message msg, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Message msg);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint extended, string cls, string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] static extern void NotifyWinEvent(uint evt, IntPtr window, int obj, int child);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int type, out ProcessInfo info, int length, out int returned);

    readonly List<Observation> events = new List<Observation>();
    readonly ManualResetEvent ready = new ManualResetEvent(false);
    readonly Thread worker;
    volatile bool stopping;
    Exception failure;
    public bool SelfTestPassed { get; private set; }

    public MnpWindowMonitor()
    {
        worker = new Thread(Run) { IsBackground = true };
        worker.Start();
        if (!ready.WaitOne(5000)) throw new Exception("Window observer did not start.");
        if (failure != null) throw new Exception("Window observer failed.", failure);
    }

    static int[] Parents(int pid)
    {
        var chain = new List<int>();
        for (int count = 0; pid > 0 && count < 16 && !chain.Contains(pid); count++)
        {
            chain.Add(pid);
            IntPtr handle = OpenProcess(0x1000, false, pid);
            if (handle == IntPtr.Zero) break;
            try
            {
                ProcessInfo info; int size;
                if (NtQueryInformationProcess(handle, 0, out info, Marshal.SizeOf(typeof(ProcessInfo)), out size) != 0) break;
                pid = info.parent.ToInt32();
            }
            finally { CloseHandle(handle); }
        }
        return chain.ToArray();
    }

    void OnEvent(IntPtr hook, uint evt, IntPtr window, int obj, int child, uint thread, uint time)
    {
        if (window == IntPtr.Zero || obj != 0 || child != 0) return;
        uint pid; GetWindowThreadProcessId(window, out pid);
        var cls = new StringBuilder(256);
        GetClassName(window, cls, cls.Capacity);
        lock (events) events.Add(new Observation { ProcessId = (int)pid, Ancestry = Parents((int)pid), WindowClass = cls.ToString() });
    }

    static void Pump()
    {
        Message msg;
        while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
    }

    void Run()
    {
        IntPtr hook = IntPtr.Zero, fixture = IntPtr.Zero;
        WinEventCallback callback = OnEvent;
        try
        {
            hook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, callback, 0, 0, 0);
            if (hook == IntPtr.Zero) throw new Exception("SetWinEventHook failed.");
            // Message-only window: verify event delivery without displaying a window.
            fixture = CreateWindowEx(0, "STATIC", "MnP observer self-test", 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (fixture == IntPtr.Zero) throw new Exception("Observer self-test window could not be created.");
            NotifyWinEvent(0x8002, fixture, 0, 0);
            var deadline = Stopwatch.StartNew();
            while (deadline.ElapsedMilliseconds < 2000)
            {
                Pump();
                lock (events) SelfTestPassed = events.Exists(e => e.ProcessId == Process.GetCurrentProcess().Id && e.WindowClass == "Static");
                if (SelfTestPassed) break;
                Thread.Sleep(1);
            }
            if (!SelfTestPassed) throw new Exception("Observer did not receive its control SHOW event.");
            lock (events) events.Clear();
            ready.Set();
            while (!stopping) { Pump(); Thread.Sleep(1); }
            Pump();
        }
        catch (Exception error) { failure = error; ready.Set(); }
        finally
        {
            if (fixture != IntPtr.Zero) DestroyWindow(fixture);
            if (hook != IntPtr.Zero) UnhookWinEvent(hook);
            GC.KeepAlive(callback);
        }
    }

    public Observation[] Snapshot() { lock (events) return events.ToArray(); }
    public void Dispose() { stopping = true; worker.Join(5000); ready.Dispose(); if (failure != null) throw new Exception("Window observer failed.", failure); }
}

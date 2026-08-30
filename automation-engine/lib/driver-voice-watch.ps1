# driver-voice-watch.ps1 -- real-time watcher over the display driver's own error channel.
# Tier 2 of bugs/79 (plans/79 step 3.5). Recon: researches/30 section 1.3.
#
# ASCII ONLY, ON PURPOSE. The agent's file tools write UTF-8 without a BOM and PowerShell 5.1 reads
# that as windows-1251, which turns Cyrillic in a .ps1 SOURCE into a PARSE error (EXP-0122). The
# Russian-language explanation of this file lives in driver-voice.mjs, next to its caller.
#
# PUSH, NOT POLL. Microsoft's own documentation contrasts EvtSubscribe's push model with polling and
# states plainly that Get-WinEvent cannot be read continuously. EventLogWatcher is the .NET wrapper
# over EvtSubscribe: no dependency, no elevation (the System log reads unelevated on this machine),
# no process spawned per tick.
#
# TWO LINE KINDS ON STDOUT, and the second one is not decoration:
#   EVENT {json}   one driver error, as it arrives
#   ALIVE <iso>    once a second -- so that SILENCE OF THE CHANNEL can be told apart from DEATH OF
#                  THE WATCHER. Before bugs/83 the same confusion made an instrument unreadable.
#
# GPU WRITES: none. This process reads the Windows event log and writes to stdout.

$ErrorActionPreference = 'Stop'

# Arguments exist for ONE reason: the bench. A latency figure taken on a channel nobody can trigger
# unprivileged would be an estimate, and this project does not ship estimates as measurements. The
# bench points the same code at the 'Windows PowerShell' log, whose provider fires on every engine
# start -- a real push through the same EventLogWatcher, timed end to end.
$provider = if ($args.Count -ge 1 -and $args[0]) { $args[0] } else { 'nvlddmkm' }
$logName  = if ($args.Count -ge 2 -and $args[1]) { $args[1] } else { 'System' }
$xpath = "*[System[Provider[@Name='$provider']]]"

try {
    $query = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery($logName, 'LogName', $xpath)
    $watcher = New-Object System.Diagnostics.Eventing.Reader.EventLogWatcher($query)
    Register-ObjectEvent -InputObject $watcher -EventName EventRecordWritten -SourceIdentifier DriverVoice | Out-Null
    $watcher.Enabled = $true
} catch {
    # A watcher that cannot start says so on stdout and exits non-zero. Silence would read as
    # "the channel is quiet", which is the one thing it must never be mistaken for.
    [Console]::Out.WriteLine("FAILED " + $_.Exception.Message)
    [Console]::Out.Flush()
    exit 2
}

[Console]::Out.WriteLine("READY " + (Get-Date).ToString('o') + " provider=" + $provider + " log=" + $logName)
[Console]::Out.Flush()

try {
    while ($true) {
        # One second is BOTH the alive cadence and the wait: a second timer would be a second
        # source of truth, able to report "alive" for a loop that has already stopped.
        $ev = Wait-Event -SourceIdentifier DriverVoice -Timeout 1
        if ($ev) {
            $rec = $ev.SourceEventArgs.EventRecord
            $obj = New-Object psobject -Property @{
                at    = $rec.TimeCreated.ToString('o')
                id    = $rec.Id
                level = $rec.Level
            }
            [Console]::Out.WriteLine("EVENT " + ($obj | ConvertTo-Json -Compress))
            Remove-Event -EventIdentifier $ev.EventIdentifier
        } else {
            [Console]::Out.WriteLine("ALIVE " + (Get-Date).ToString('o'))
        }
        [Console]::Out.Flush()
    }
} finally {
    $watcher.Enabled = $false
    Unregister-Event -SourceIdentifier DriverVoice -ErrorAction SilentlyContinue
    $watcher.Dispose()
}

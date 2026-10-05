<#
  Registers Windows scheduled tasks for the brain-curator agent:
    - MyCurrentBrain-Daily   every day at $DailyAt
    - MyCurrentBrain-Weekly  Sundays at $WeeklyAt
  The tasks run as the current user, so Claude Code uses your logged-in subscription.

  Usage:   powershell -File scripts/schedule-agent.ps1 [-DailyAt 07:00] [-WeeklyAt 18:00]
  Remove:  Unregister-ScheduledTask -TaskName MyCurrentBrain-Daily,MyCurrentBrain-Weekly
#>
param(
  [string]$DailyAt = "07:00",
  [string]$WeeklyAt = "18:00"
)

$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot "run-agent.ps1"

function Register-BrainTask($name, $task, $trigger) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Task $task" `
    -WorkingDirectory $root
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Registered $name"
}

Register-BrainTask "MyCurrentBrain-Daily" "daily" (New-ScheduledTaskTrigger -Daily -At $DailyAt)
Register-BrainTask "MyCurrentBrain-Weekly" "weekly" (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $WeeklyAt)

Set WshShell = CreateObject("WScript.Shell")
strDesktop = WshShell.SpecialFolders("Desktop")
Set oLink = WshShell.CreateShortcut(strDesktop & "\SupaisuClip.lnk")
oLink.TargetPath = "E:\SupaisuClip\Start-SupaisuClip.bat"
oLink.WorkingDirectory = "E:\SupaisuClip"
oLink.Description = "SupaisuClip - AI Vertical Video Studio"
oLink.Save
WScript.Echo "Shortcut 'SupaisuClip' berhasil dibuat di Desktop Anda!"

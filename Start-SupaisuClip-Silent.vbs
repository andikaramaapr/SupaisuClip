Set WshShell = CreateObject("WScript.Shell")
' Menjalankan launcher tanpa memunculkan jendela console hitam
WshShell.Run "cmd /c ""E:\SupaisuClip\Start-SupaisuClip.bat""", 0, False

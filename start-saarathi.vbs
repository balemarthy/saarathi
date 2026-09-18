' Launches Saarathi without opening a visible console window.
' Double-click this file to start the orb.

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "E:\saarathi"
WshShell.Run "cmd /c npm start", 0, False

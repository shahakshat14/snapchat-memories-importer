# Verify Downloads

Checksums help confirm your downloaded installer matches the file published on GitHub.

## Current Beta Checksums

```text
macOS DMG    SHA-256 e3c1e6e055209e8dcb058168e13ca027089dafdeb6e83444e3e13f5cfc021e82
Windows EXE  SHA-256 b5bfe7f81c8cde628c5df1c5347ded2bfe302322b7c285da1005109afbe0a342
```

## macOS

Open Terminal and run:

```bash
shasum -a 256 ~/Downloads/Snapchat-Memories-Importer-0.1.0.dmg
```

The printed hash should match the macOS DMG checksum above.

## Windows

Open PowerShell and run:

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\Snapchat-Memories-Importer-Setup-0.1.0.exe" -Algorithm SHA256
```

The printed hash should match the Windows EXE checksum above.
